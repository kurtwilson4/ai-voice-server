// index.js
const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
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
  const callerNumber = req.body.From;

  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that helps users book Airbnb container homes in Livingston, Texas. Ask for check-in and check-out dates, number of guests, and name for the booking. Once you have all the information, confirm the reservation. Accept the info in any order.',
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say("Hello, welcome to LW Wilson Airbnb Container Homes. What can I help you with today?", { voice: 'alice' });
    res.type('text/xml');
    return res.send(twiml.toString());
  } else {
    sessions[callSid].push({ role: 'user', content: userSpeech });
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: sessions[callSid],
    });

    const aiReply = completion.choices[0].message.content;
    sessions[callSid].push({ role: 'assistant', content: aiReply });

    // Extract details
    const dateRegex = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?\b/gi;
    const guestRegex = /\b(\d+)\s+guests?\b/i;
    const nameRegex = /\b(?:guest name is|name is|for|under the name of|under the name)\s+([A-Z][a-z]+\s[A-Z][a-z]+)\b/;

    const dates = aiReply.match(dateRegex);
    const guestsMatchUser = userSpeech.match(guestRegex);
    const guestsMatchAI = aiReply.match(guestRegex);
    const guests = guestsMatchAI?.[1] || guestsMatchUser?.[1] || null;

    const nameMatch = aiReply.match(nameRegex);
    const name = nameMatch ? nameMatch[1] : null;

    console.log('🧠 AI reply:', aiReply);
    console.log('📅 Dates:', dates);
    console.log('👥 Guests:', guests);
    console.log('🧑 Name:', name);
    console.log('📞 Caller Number:', callerNumber);

    if (dates && guests && name) {
      const event = {
        summary: `Booking for ${name} - ${guests} guests`,
        description: `Airbnb container home booking for ${name} via AI phone assistant.`,
        start: { date: parseDate(dates[0]), timeZone: 'America/Chicago' },
        end: { date: parseDate(dates[1] || dates[0]), timeZone: 'America/Chicago' },
      };
      try {
        const response = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event,
        });
        console.log('✅ Event created:', response.data);

        // Send text confirmation
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: `Thank you, ${name}. Your Airbnb booking from ${dates[0]} to ${dates[1] || dates[0]} for ${guests} guests is confirmed.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: callerNumber,
        });
        console.log('📲 Text confirmation sent to', callerNumber);
      } catch (err) {
        console.error('❌ Calendar or SMS error:', err.response?.data || err.message);
      }
    }

    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say(aiReply, { voice: 'alice' });
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

function parseDate(str) {
  const clean = str.toLowerCase().replace(/(st|nd|rd|th)/g, '');
  const [month, day] = clean.split(' ');
  const year = new Date().getFullYear();
  const monthIndex = new Date(`${month} 1, ${year}`).getMonth() + 1;
  return `${year}-${('0' + monthIndex).slice(-2)}-${('0' + day).slice(-2)}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
