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

      // Check calendar for double booking
      const [start, end] = [parseDate(dates[0]), parseDate(dates[1] || dates[0])];
      const events = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(new Date(end).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      if (events.data.items.length > 0) {
        return ask("Sorry, it looks like we already have a booking during that time. Is there another date you're interested in?");
      }

      return ask("Great. How many adults and how many children will be staying?");
    } else {
      return ask("Sorry, I didn’t catch the dates. Can you say the check-in and check-out dates again?");
    }
  } else if (session.step === 1) {
    const adultMatch = lower.match(/(\d+)\s+adults?/i);
    const childMatch = lower.match(/(\d+)\s+children?/i);
    const totalGuests = (adultMatch ? parseInt(adultMatch[1]) : 0) + (childMatch ? parseInt(childMatch[1]) : 0);
    if (totalGuests > 0) {
      session.data.guests = totalGuests;
      session.step = 2;
      return ask("Thanks. What is the name the booking will be under?");
    } else {
      return ask("I didn’t catch the number of guests. Please repeat how many adults and children will be staying.");
    }
  } else if (session.step === 2) {
    const nameMatch = userSpeech.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/);
    if (nameMatch) {
      session.data.name = nameMatch[1];
      session.step = 3;
      return ask("Thanks. Lastly, what is the best email for your confirmation?");
    } else {
      session.step = 3.5;
      return ask("I didn't quite get the name. Can you please spell it out?");
    }
  } else if (session.step === 3.5 && !session.data.name) {
    const letters = userSpeech.match(/[a-z]/gi);
    if (letters && letters.length >= 4) {
      session.data.name = letters.join('');
      session.step = 3;
      return ask("Thanks. Lastly, what is the best email for your confirmation?");
    } else {
      return ask("Sorry, I still didn’t catch that. Please try spelling the name again.");
    }
  } else if (session.step === 3) {
    const emailMatch = lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    if (emailMatch) {
      session.data.email = emailMatch[0];
      session.step = 4;
    } else {
      return ask("I didn’t catch your email. Could you say it again?");
    }
  }

  // ✅ All data collected, create event
  if (session.step === 4 && session.data.dates && session.data.guests && session.data.name && session.data.email) {
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
    } catch (err) {
      console.error('❌ Calendar error:', err.response?.data || err.message);
    }

    // Send email
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_FROM,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: `"LW Wilson Airbnb" <${process.env.EMAIL_FROM}>`,
        to: session.data.email,
        subject: "Your Airbnb Booking is Confirmed!",
        text: `Thank you, ${session.data.name}. Your Airbnb booking from ${startDate} to ${endDate || startDate} for ${session.data.guests} guests is confirmed. We look forward to hosting you in Livingston, Texas!`,
      });

      console.log(`📧 Email confirmation sent to ${session.data.email}`);
    } catch (err) {
      console.error('❌ Email error:', err.message);
    }

    // Final response
    twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate || startDate} for ${session.data.guests} guests is confirmed. A confirmation email has been sent to ${session.data.email}. Enjoy your stay!`);
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
