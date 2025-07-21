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
if (!googleServiceAccount) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT env var.");
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
        content: 'You are a helpful assistant that books Airbnb container homes. Ask for check-in and check-out dates, number of guests, and name. Info may come in any order. Confirm only after all are provided.',
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say("Hello, welcome to LW Wilson Airbnb Container Homes. What can I help you with today?", { voice: 'alice' });
  } else {
    sessions[callSid].push({ role: 'user', content: userSpeech });
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: sessions[callSid],
    });

    const aiReply = completion.choices[0].message.content;
    sessions[callSid].push({ role: 'assistant', content: aiReply });

    // Extract booking info
    const dateRegex = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?\b/gi;
    const guestRegex = /\b(\d+)\s+guests?\b/i;
    const nameRegex = /\b(?:guest name is|name is|for|under the name of|under the name)\s+([A-Z][a-z]+\s[A-Z][a-z]+)\b/;

    const dates = [...(aiReply.match(dateRegex) || []), ...(userSpeech.match(dateRegex) || [])];
    const guestsMatch = userSpeech.match(guestRegex) || aiReply.match(guestRegex);
    const nameMatch = aiReply.match(nameRegex) || userSpeech.match(nameRegex);

    const guests = guestsMatch ? guestsMatch[1] : null;
    const name = nameMatch ? nameMatch[1] : null;

    console.log('📅 Dates:', dates);
    console.log('👥 Guests:', guests);
    console.log('🧑 Name:', name);
    console.log('📞 Caller Number:', callerNumber);

    let missing = [];
    if (!dates.length) missing.push('check-in and check-out dates');
    if (!guests) missing.push('number of guests');
    if (!name) missing.push('your name');

    if (!missing.length) {
      const startDate = parseDate(dates[0]);
      const endDate = parseDate(dates[1] || dates[0]);

      // Calendar availability check
      const existingEvents = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: new Date(startDate).toISOString(),
        timeMax: new Date(endDate).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      if (existingEvents.data.items.length > 0) {
        const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
        gather.say("Unfortunately, those dates are already booked. Please choose different dates.", { voice: 'alice' });
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Create event
      const event = {
        summary: `Booking for ${name} - ${guests} guests`,
        description: `AI booking for ${name} via phone assistant.`,
        start: { date: startDate, timeZone: 'America/Chicago' },
        end: { date: endDate, timeZone: 'America/Chicago' },
      };

      try {
        const response = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event,
        });
        console.log('✅ Event created:', response.data);
      } catch (err) {
        console.error('❌ Calendar error:', err.response?.data || err.message);
      }

      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say(`Thanks ${name}, your Airbnb booking from ${dates[0]} to ${dates[1] || dates[0]} for ${guests} guests is confirmed.`, { voice: 'alice' });
    } else {
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say(`Thanks. I still need: ${missing.join(', ')}.`, { voice: 'alice' });
    }
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
