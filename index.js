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
    sessions[callSid] = { step: 0, data: {} };
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say("Hello, welcome to LW Wilson Airbnb Container Homes. What dates would you like to book?", { voice: 'alice' });
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const session = sessions[callSid];

  const sayNextPrompt = (prompt) => {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say(prompt, { voice: 'alice' });
    res.type('text/xml');
    res.send(twiml.toString());
  };

  const dateRegex = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?\b/gi;
  const guestRegex = /\b(\d+)\s+guests?\b/i;
  const nameRegex = /(?:name is|under the name of|for)\s+([A-Z][a-z]+\s[A-Z][a-z]+)/i;

  if (session.step === 0) {
    const dates = userSpeech.match(dateRegex);
    if (dates && dates.length >= 1) {
      session.data.dates = dates;
      session.step = 1;
      return sayNextPrompt("Thank you. How many guests will be staying?");
    } else {
      return sayNextPrompt("Sorry, I didn't catch the dates. Please say your check-in and check-out dates.");
    }
  }

  if (session.step === 1) {
    const guestsMatch = userSpeech.match(guestRegex);
    if (guestsMatch) {
      session.data.guests = guestsMatch[1];
      session.step = 2;
      return sayNextPrompt("Got it. And what name should I put the booking under?");
    } else {
      return sayNextPrompt("Sorry, how many guests will be staying?");
    }
  }

  if (session.step === 2) {
    const nameMatch = userSpeech.match(nameRegex);
    if (nameMatch) {
      session.data.name = nameMatch[1];
      session.step = 3;

      const { dates, guests, name } = session.data;
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

      return sayNextPrompt(`Thank you, ${session.data.name}. Your booking from ${session.data.dates[0]} to ${session.data.dates[1] || session.data.dates[0]} for ${session.data.guests} guests is confirmed.`);
    } else {
      return sayNextPrompt("Sorry, I didn't catch the name. What name should I put the booking under?");
    }
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
