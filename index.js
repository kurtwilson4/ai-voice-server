const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const chrono = require('chrono-node');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Calendar auth setup
const googleServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
if (!googleServiceAccount) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT is not set in environment variables.");
}
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(googleServiceAccount, 'base64').toString('utf-8')),
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth });

const sessions = {};

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult;

  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that helps users book Airbnb container homes in Livingston, Texas. Ask for check-in/out dates and number of guests. Once received, confirm the booking and do not ask "anything else" unless unclear.',
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
  } else {
    sessions[callSid].push({ role: 'user', content: userSpeech });

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: sessions[callSid],
    });

    const aiReply = completion.choices[0].message.content;
    sessions[callSid].push({ role: 'assistant', content: aiReply });

    // Extract guest count from user speech
    const guestRegex = /\b(\d+) guests?/i;
    const guestsMatch = userSpeech.match(guestRegex);
    const guests = guestsMatch ? guestsMatch[1] : null;

    // Extract dates using chrono-node
    const parsedDates = chrono.parse(userSpeech);
    let start = null;
    let end = null;
    if (parsedDates.length > 0) {
      start = parsedDates[0].start.date();
      end = parsedDates[0].end ? parsedDates[0].end.date() : start;
    }

    console.log('🧠 AI Reply:', aiReply);
    console.log('📅 Start Date:', start);
    console.log('📅 End Date:', end);
    console.log('👥 Guests:', guests);

    if (start && guests) {
      const formatDate = (d) => d.toISOString().split('T')[0];
      const event = {
        summary: `Booking for ${guests} guests`,
        description: 'Airbnb container home booking via AI call assistant.',
        start: { date: formatDate(start), timeZone: 'America/Chicago' },
        end: { date: formatDate(end), timeZone: 'America/Chicago' },
      };
      try {
        const response = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event,
        });
        console.log('✅ Event created:', response.data);
      } catch (err) {
        console.error('❌ Calendar booking error:', err.response?.data || err.message);
      }
    }

    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say(aiReply, { voice: 'alice' });
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
