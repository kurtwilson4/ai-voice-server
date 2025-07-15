const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Calendar setup
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')),
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth });

const sessions = {};

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult || '';
  const callerNumber = req.body.From;

  if (!sessions[callSid]) {
    sessions[callSid] = {
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful AI assistant that books Airbnb container homes in Livingston, Texas. Ask for check-in and check-out dates, number of guests, and name for the booking. Once all details are collected, confirm the reservation clearly.',
        },
      ],
      fullTranscript: '',
    };
  }

  // Save conversation
  sessions[callSid].messages.push({ role: 'user', content: userSpeech });
  sessions[callSid].fullTranscript += ' ' + userSpeech;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: sessions[callSid].messages,
  });

  const aiReply = completion.choices[0].message.content;
  sessions[callSid].messages.push({ role: 'assistant', content: aiReply });

  // Match from full transcript
  const transcript = sessions[callSid].fullTranscript;
  const dateRegex = /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s\d{1,2}(?:st|nd|rd|th)?/gi;
  const guestRegex = /(\d+)\s+guests?/i;
  const nameRegex = /\b(?:my name is|this is|name is|for|under the name of)\s+([A-Z][a-z]+\s[A-Z][a-z]+)\b/i;

  const dates = transcript.match(dateRegex);
  const guestsMatch = transcript.match(guestRegex);
  const nameMatch = transcript.match(nameRegex);

  const guests = guestsMatch ? guestsMatch[1] : null;
  const name = nameMatch ? nameMatch[1] : null;

  console.log('🧠 AI reply:', aiReply);
  console.log('📅 Dates:', dates);
  console.log('👥 Guests:', guests);
  console.log('🧑 Name:', name);
  console.log('📞 Caller Number:', callerNumber);

  if (dates?.length >= 1 && guests && name) {
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

      // Send SMS confirmation
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const smsBody = `✅ Your booking for ${guests} guests from ${dates[0]} to ${dates[1] || dates[0]} is confirmed under the name ${name}.`;

      await client.messages.create({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });

      console.log(`📲 Text confirmation sent to ${callerNumber}`);
    } catch (err) {
      console.error('❌ Error creating calendar or sending SMS:', err);
    }
  }

  const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
  gather.say(aiReply, { voice: 'alice' });

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
