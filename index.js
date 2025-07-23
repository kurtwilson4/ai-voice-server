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
  }
  const session = sessions[callSid];

  const ask = (text) => {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, text);
    res.type('text/xml');
    res.send(twiml.toString());
  };

  if (!userSpeech) {
    return ask("Hello! Welcome to LW Wilson Airbnb Container Homes! What are the check-in and check-out dates you're interested in?");
  }

  const lower = userSpeech.toLowerCase();
  if (session.step === 0) {
    const dates = userSpeech.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?/gi);
    if (dates && dates.length >= 1) {
      session.data.dates = dates;
      session.step = 1;
      return ask("Great. How many guests will be staying?");
    } else {
      return ask("Sorry, I didn’t catch the dates. Can you say the check-in and check-out dates again?");
    }
  } else if (session.step === 1) {
    const guests = userSpeech.match(/\b(\d+)\s+guests?/i);
    if (guests) {
      session.data.guests = guests[1];
      session.step = 2;
      return ask("Thanks. What is the name the booking will be under?");
    } else {
      return ask("I didn’t catch the number of guests. Please repeat it.");
    }
  } else if (session.step === 2) {
    const nameMatch = userSpeech.match(/([A-Z][a-z]+\s[A-Z][a-z]+)/);
    if (nameMatch) {
      session.data.name = nameMatch[1];
      session.step = 3;
    } else {
      session.step = 3;
      return ask("I didn't quite get the name. Can you please spell it out?");
    }
  } else if (session.step === 3 && !session.data.name) {
    const letters = userSpeech.match(/[a-z]/gi);
    if (letters && letters.length >= 4) {
      session.data.name = letters.join('').replace(/(.)(?=[A-Z])/g, '$1 ');
    } else {
      return ask("Sorry, I still didn’t catch that. Please try spelling it again.");
    }
  }

  // If all data collected
  if (session.data.dates && session.data.guests && session.data.name) {
    const [startDate, endDate] = session.data.dates;
    const event = {
      summary: `Booking for ${session.data.name} - ${session.data.guests} guests`,
      description: `Airbnb container home booking for ${session.data.name} via AI phone assistant.`,
      start: { date: parseDate(startDate), timeZone: 'America/Chicago' },
      end: { date: parseDate(endDate || startDate), timeZone: 'America/Chicago' },
    };
    try {
      const response = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: event,
      });
      console.log('✅ Event created:', response.data);

      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Thank you, ${session.data.name}. Your Airbnb booking from ${startDate} to ${endDate || startDate} for ${session.data.guests} guests is confirmed.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });
    } catch (err) {
      console.error('❌ Calendar/SMS error:', err.response?.data || err.message);
    }
    twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate || startDate} for ${session.data.guests} guests is confirmed. Enjoy your stay!`);
    delete sessions[callSid];
  }

  res.type('text/xml');
  res.send(twiml.toString());
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
