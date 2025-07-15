const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Calendar auth
const googleServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

if (!googleServiceAccount) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_BASE64 is not set in environment variables.");
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
          'You are a helpful AI assistant that helps users book Airbnb container homes in Livingston, Texas. Ask for check-in/out dates, number of guests, and guest name. Confirm the booking when all details are received.',
      },
    ];
    sessions[callSid].data = {
      name: null,
      guests: null,
      dates: [],
    };
  }

  const session = sessions[callSid];

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
  } else {
    session.push({ role: 'user', content: userSpeech });

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: session,
    });

    const aiReply = completion.choices[0].message.content;
    session.push({ role: 'assistant', content: aiReply });

    // Extract booking info
    const dateRegex = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
    const guestRegex = /\b(\d+)\s+guests?/i;
    const nameRegex = /(?:my name is|this is|under the name)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i;

    const dates = aiReply.match(dateRegex);
    const guestsMatch = userSpeech.match(guestRegex);
    const nameMatch = userSpeech.match(nameRegex);

    if (dates) session.data.dates = dates;
    if (guestsMatch) session.data.guests = guestsMatch[1];
    if (nameMatch) session.data.name = nameMatch[1];

    console.log('🧠 AI reply:', aiReply);
    console.log('📅 Dates:', session.data.dates);
    console.log('👥 Guests:', session.data.guests);
    console.log('🧑 Name:', session.data.name);

    if (session.data.dates.length >= 1 && session.data.guests && session.data.name) {
      const event = {
        summary: `Booking for ${session.data.guests} guests – ${session.data.name}`,
        description: `Booked by ${session.data.name} for ${session.data.guests} guests via AI call assistant.`,
        start: {
          date: parseDate(session.data.dates[0]),
          timeZone: 'America/Chicago',
        },
        end: {
          date: parseDate(session.data.dates[1] || session.data.dates[0]),
          timeZone: 'America/Chicago',
        },
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
    } else {
      let prompt = '';
      if (!session.data.name) prompt += 'What name should I put the reservation under? ';
      if (!session.data.guests) prompt += 'How many guests will be staying? ';
      if (session.data.dates.length === 0) prompt += 'What are your check-in and check-out dates? ';

      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say(prompt.trim(), { voice: 'alice' });
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say(aiReply, { voice: 'alice' });
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

function parseDate(str) {
  const cleaned = str.replace(/(st|nd|rd|th)/gi, '');
  const [month, day] = cleaned.trim().split(' ');
  const year = new Date().getFullYear();
  const monthIndex = new Date(`${month} 1, ${year}`).getMonth() + 1;
  return `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
