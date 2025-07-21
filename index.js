// index.js (GPT JSON mode version)
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
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')),
  scopes: ['https://www.googleapis.com/auth/calendar']
});
const calendar = google.calendar({ version: 'v3', auth });

const sessions = {};

// GPT function schema
const bookingFunction = {
  name: 'book_airbnb',
  description: 'Collect Airbnb booking info',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Guest full name' },
      guests: { type: 'integer', description: 'Number of guests' },
      check_in: { type: 'string', description: 'Check-in date (e.g. July 20th)' },
      check_out: { type: 'string', description: 'Check-out date (e.g. July 22nd)' }
    },
    required: ['name', 'guests', 'check_in', 'check_out']
  }
};

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult;
  const callerNumber = req.body.From;

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say("Hello, welcome to LW Wilson Airbnb Container Homes. What can I help you with today?", { voice: 'Polly.Joanna' });
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Prepare chat context
  sessions[callSid] = sessions[callSid] || [
    {
      role: 'system',
      content: 'You are a booking assistant for LW Wilson Airbnb Container Homes in Livingston, Texas. Always extract name, guest count, check-in and check-out dates.'
    }
  ];
  sessions[callSid].push({ role: 'user', content: userSpeech });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4-0613',
    messages: sessions[callSid],
    tools: [{ type: 'function', function: bookingFunction }],
    tool_choice: 'auto'
  });

  const toolCall = completion.choices[0].message.tool_calls?.[0];

  let responseSpoken = '';
  if (toolCall) {
    const args = JSON.parse(toolCall.function.arguments);
    const { name, guests, check_in, check_out } = args;

    console.log('📅 Dates:', check_in, check_out);
    console.log('👥 Guests:', guests);
    console.log('🧑 Name:', name);
    console.log('📞 Caller Number:', callerNumber);

    try {
      await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: {
          summary: `Booking for ${name} - ${guests} guests`,
          description: `Airbnb container home booking for ${name} via AI assistant.`,
          start: { date: parseDate(check_in), timeZone: 'America/Chicago' },
          end: { date: parseDate(check_out), timeZone: 'America/Chicago' }
        }
      });
      responseSpoken = `Thank you, ${name}. Your booking for ${guests} guests from ${check_in} to ${check_out} is confirmed.`;
    } catch (err) {
      responseSpoken = 'There was a problem creating your booking. Please try again later.';
      console.error('❌ Calendar error:', err.message);
    }
  } else {
    responseSpoken = "Thanks. Can you please provide your check-in and check-out dates, number of guests, and your name?";
  }

  const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
  gather.say(responseSpoken, { voice: 'Polly.Joanna' });
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
app.listen(PORT, () => console.log(`AI Voice server running on port ${PORT}`));
