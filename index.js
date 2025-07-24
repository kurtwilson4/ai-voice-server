const express = require('express');
const twilio = require('twilio');
const { google } = require('googleapis');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

// Google Calendar auth setup
const googleServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
if (!googleServiceAccount) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 is not set in environment variables.');
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
    return ask("Hello! Welcome to LW Wilson Airbnb Container Homes. What are the check-in and check-out dates you're interested in?");
  }


  // Step 0: Ask for Dates
  if (session.step === 0) {
    const dates = userSpeech.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?/gi);
    if (dates && dates.length >= 1) {
      session.data.dates = dates;
      session.step = 1;
      return ask("Great. How many guests will be staying?");
    } else {
      return ask("Sorry, I didn’t catch the dates. Can you say the check-in and check-out dates again?");
    }
  }

  // Step 1: Ask for Number of Guests
  else if (session.step === 1) {
    const guestRegex = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?:\s+(?:guests?|people|persons|will be staying))?/i;
    const guestMatch = userSpeech.match(guestRegex);
    const numberWords = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10
    };
    let guests;
    if (guestMatch) {
      const firstWord = guestMatch[0].split(/\s+/)[0].toLowerCase();
      guests = parseInt(firstWord, 10);
      if (isNaN(guests)) {
        guests = numberWords[firstWord];
      }
    }
    if (guests) {
      session.data.guests = guests;
      session.step = 2;
      return ask("Thanks. What is the name the booking will be under?");
    } else {
      return ask("I didn’t catch the number of guests. Please repeat how many guests will be staying.");
    }
  }

  // Step 2: Ask for Name
  else if (session.step === 2) {
  const nameMatch = userSpeech.match(/([A-Za-z]+\s+[A-Za-z]+)/i);
    if (nameMatch) {
      session.data.name = nameMatch[1];
      session.step = 3;
    } else {
      session.step = 3;
      return ask("I didn't quite get the name. Can you please spell it out?");
    }
  }

  // Step 3: Handle Spelled Name
  else if (session.step === 3 && !session.data.name) {
    const letters = userSpeech.match(/[a-z]/gi);
    if (letters && letters.length >= 4) {
      session.data.name = letters.join('');
    } else {
      return ask("Sorry, I still didn’t catch that. Please try spelling the name again.");
    }
  }

  // ✅ Final step: Create Event if all data collected
  if (session.data.dates && session.data.guests && session.data.name) {
    const [startDate, endDate] = session.data.dates;

    const isoStart = parseDate(startDate);
    const isoEnd = parseDate(endDate || startDate);

    try {
      // Check for double booking
      const events = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: new Date(isoStart).toISOString(),
        timeMax: new Date(isoEnd).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      if (events.data.items.length > 0) {
        twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, "Sorry, it looks like we already have a booking during that time. Is there another date you were interested in?");
        session.step = 0;
        session.data = {};
        res.type('text/xml');
        return res.send(twiml.toString());
      }

      // Book it
      const event = {
        summary: `Booking for ${session.data.name} - ${session.data.guests} guests`,
        description: `Airbnb container home booking for ${session.data.name} via AI phone assistant.`,
        start: { date: isoStart, timeZone: 'America/Chicago' },
        end: { date: isoEnd, timeZone: 'America/Chicago' },
      };
      await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: event,
      });

      // Send confirmation text
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: `Thanks ${session.data.name}, your Airbnb container home is booked from ${startDate} to ${endDate || startDate} for ${session.data.guests} guest(s).`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: callerNumber,
      });

      twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' },
        `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate || startDate} for ${session.data.guests} guests is confirmed. Enjoy your stay!`
      );
    } catch (err) {
      console.error("❌ Error creating event or sending SMS:", err.response?.data || err.message);
      twiml.say("Something went wrong while trying to book your reservation. Please try again later.");
    }

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
