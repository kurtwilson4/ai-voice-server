const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Calendar setup
const auth = new google.auth.GoogleAuth({
  keyFile: 'google-calendar-service-account.json', // Your downloaded file
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });
const calendarId = process.env.GOOGLE_CALENDAR_ID;

// Conversation sessions
const sessions = {};

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult;

  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content: `You're a helpful AI receptionist for a container home Airbnb in Livingston, Texas. Help the caller book a stay by collecting the dates and number of guests. Check availability and confirm the booking.`,
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST',
    });
    gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  sessions[callSid].push({ role: 'user', content: userSpeech });

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: sessions[callSid],
    tools: [
      {
        type: 'function',
        function: {
          name: 'create_booking',
          description: 'Books an Airbnb stay',
          parameters: {
            type: 'object',
            properties: {
              startDate: { type: 'string', format: 'date', description: 'Check-in date (YYYY-MM-DD)' },
              endDate: { type: 'string', format: 'date', description: 'Check-out date (YYYY-MM-DD)' },
              guests: { type: 'number', description: 'Number of guests' },
            },
            required: ['startDate', 'endDate', 'guests'],
          },
        },
      },
    ],
    tool_choice: 'auto',
  });

  const response = completion.choices[0];
  const toolCall = response?.message?.tool_calls?.[0];

  let replyText;

  if (toolCall?.function?.name === 'create_booking') {
    const args = JSON.parse(toolCall.function.arguments);
    const { startDate, endDate, guests } = args;

    try {
      const availability = await calendar.freebusy.query({
        requestBody: {
          timeMin: new Date(startDate).toISOString(),
          timeMax: new Date(endDate).toISOString(),
          timeZone: 'America/Chicago',
          items: [{ id: calendarId }],
        },
      });

      const isBusy = availability.data.calendars[calendarId].busy.length > 0;

      if (isBusy) {
        replyText = `Unfortunately, the container home is not available from ${startDate} to ${endDate}. Would you like to choose different dates?`;
      } else {
        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: `Airbnb Booking for ${guests} guest(s)`,
            start: { date: startDate },
            end: { date: endDate },
            description: `AI phone booking for ${guests} guest(s).`,
          },
        });

        replyText = `You're all set! I've booked the container home for ${guests} guest(s) from ${startDate} to ${endDate}. Is there anything else I can help you with?`;
      }
    } catch (err) {
      console.error(err);
      replyText = `Sorry, there was a problem checking availability. Please try again later.`;
    }
  } else {
    replyText = response.message.content;
  }

  sessions[callSid].push({ role: 'assistant', content: replyText });

  const gather = twiml.gather({
    input: 'speech',
    action: '/voice',
    method: 'POST',
  });
  gather.say(replyText, { voice: 'alice' });

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
