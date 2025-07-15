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

  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that helps users book Airbnb container homes in Livingston, Texas. Ask for check-in/out dates, number of guests, and the name of the primary guest. Once all details are gathered, confirm the booking.',
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

    // Extraction logic
    const dateRegex = /(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?/gi;
    const guestRegex = /\b(\d+)\s*guests?\b/i;
    const nameRegex = /(?:name (?:is|should be|under the name)?[:\-]?\s*|for )([A-Z][a-z]+\s[A-Z][a-z]+)/i;

    const dates = aiReply.match(dateRegex);
    const guestsMatch = userSpeech.match(guestRegex) || aiReply.match(guestRegex);
    const nameMatch = userSpeech.match(nameRegex) || aiReply.match(nameRegex);

    const guests = guestsMatch ? guestsMatch[1] : null;
    const name = nameMatch ? nameMatch[1] : null;

    console.log('🧠 AI reply:', aiReply);
    console.log('📅 Dates:', dates);
    console.log('👥 Guests:', guests);
    console.log('🧑 Name:', name);

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

function parseDate(str) {
  const cleaned = str.toLowerCase().replace(/(st|nd|rd|th)/, '');
  const [month, day] = cleaned.split(' ');
  const year = new Date().getFullYear();
  return `${year}-${('0' + (new Date(`${month} 1`).getMonth() + 1)).slice(-2)}-${('0' + day).slice(-2)}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
