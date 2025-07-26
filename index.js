const express = require('express');
const twilio = require('twilio');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
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

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    // default to the lwwilsoncontainerhomes@gmail.com account if EMAIL_USER is not set
    user: process.env.EMAIL_USER || 'lwwilsoncontainerhomes@gmail.com',
    pass: process.env.EMAIL_PASS,
  },
});

const sessions = {};

async function finalizeBooking(session) {
  const [startDate, endDate] = session.data.dates;

  const isoStart = parseDate(startDate);
  const isoEnd = parseDate(endDate || startDate);
  const isoEndExclusive = new Date(new Date(isoEnd).getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Book the calendar event
  const event = {
    summary: `Booking for ${session.data.name} - ${session.data.guests} guests`,
    description: `Airbnb container home booking for ${session.data.name} via AI phone assistant.`,
    start: { date: isoStart, timeZone: 'America/Chicago' },
    end: { date: isoEndExclusive, timeZone: 'America/Chicago' },
  };
  await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    resource: event,
  });

  return { startDate, endDate: endDate || startDate };
}

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
    const dates = parseDateRange(userSpeech);
    if (dates && dates.length >= 1) {
      const [startDate, endDate] = dates;
      const isoStart = parseDate(startDate);
      const isoEnd = parseDate(endDate || startDate);

      try {
        // Check for double booking
        const isoStartTime = new Date(isoStart).toISOString();
        const isoEndExclusiveTime = new Date(new Date(isoEnd).getTime() + 24 * 60 * 60 * 1000).toISOString();

        const events = await calendar.events.list({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          timeMin: isoStartTime,
          timeMax: isoEndExclusiveTime,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const startObj = new Date(isoStartTime);
        const endObj = new Date(isoEndExclusiveTime);

        const hasConflict = events.data.items.some(ev => {
          const evStart = new Date(ev.start.date || ev.start.dateTime);
          const evEnd = new Date(ev.end.date || ev.end.dateTime);
          return evStart < endObj && evEnd > startObj;
        });

        if (hasConflict) {
          return ask("Sorry, it looks like we already have a booking during that time. Is there another date you were interested in?");
        }
      } catch (err) {
        console.error("Error checking calendar availability:", err.response?.data || err.message);

        return ask("Something went wrong while checking availability. Could you provide another date?");
      }

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
    const parsedName = parseSpokenName(userSpeech);
    if (parsedName) {
      session.data.name = parsedName;
      try {
        const { startDate, endDate } = await finalizeBooking(session);
        twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' },
          `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate} for ${session.data.guests} guests is confirmed.`
        );
        const gather = twiml.gather({
          input: 'speech',
          action: '/voice',
          method: 'POST',
          hints: 'gmail.com yahoo.com outlook.com hotmail.com icloud.com'
        });
        gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, 'To send you a confirmation email, please say your email address.');
        // Move directly to email capture after successfully recording the name
        session.step = 4;
        return res.type('text/xml').send(twiml.toString());
      } catch (err) {
        console.error('❌ Error creating calendar event:', err.response?.data || err.message);
        twiml.say('Something went wrong while trying to book your reservation. Please try again later.');
        delete sessions[callSid];
        return res.type('text/xml').send(twiml.toString());
      }
    } else {
      session.step = 3;
      return ask("I didn't quite get the name. Can you please spell it out?");
    }
  }

  // Step 3: Handle Spelled Name
  else if (session.step === 3 && !session.data.name) {
    const spelledName = parseSpokenName(userSpeech);
    if (spelledName) {
      session.data.name = spelledName;
      try {
        const { startDate, endDate } = await finalizeBooking(session);
        twiml.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' },
          `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate} for ${session.data.guests} guests is confirmed.`
        );
        const gather = twiml.gather({
          input: 'speech',
          action: '/voice',
          method: 'POST',
          hints: 'gmail.com yahoo.com outlook.com hotmail.com icloud.com'
        });
        gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, 'To send you a confirmation email, please say your email address.');
        session.step = 4;
        return res.type('text/xml').send(twiml.toString());
      } catch (err) {
        console.error('❌ Error creating calendar event:', err.response?.data || err.message);
        twiml.say('Something went wrong while trying to book your reservation. Please try again later.');
        delete sessions[callSid];
        return res.type('text/xml').send(twiml.toString());
      }
    } else {
      return ask("Sorry, I still didn’t catch that. Please try spelling the name again.");
    }
  }

  // Step 4: Capture Email and confirm spelling
  else if (session.step === 4) {
    const parsedEmail = parseSpokenEmail(userSpeech);
    const emailMatch = parsedEmail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) {
      session.data.email = emailMatch[0];
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `I heard your email as ${spellEmailForSpeech(session.data.email)}. Is that correct? Please say yes or no.`);
      session.step = 5;
      return res.type('text/xml').send(twiml.toString());
    } else {
      return ask("I didn't catch that email. Could you repeat the email address?");
    }
  }

  // Step 5: Confirm email address
  else if (session.step === 5) {
    const positive = /\b(yes|correct|yeah)\b/i.test(userSpeech);
    const negative = /\b(no|incorrect|nah)\b/i.test(userSpeech);
    if (positive) {
      // Respond to Twilio immediately to avoid timeouts, then send the email
      twiml.say('Thanks! A confirmation email has been sent. Goodbye.');
      res.type('text/xml').send(twiml.toString());

      console.log('Email confirmed:', session.data.email, 'Call SID:', callSid);

      transporter
        .sendMail({
          from: 'lwwilsoncontainerhomes@gmail.com',
          to: session.data.email,
          subject: 'Your booking is confirmed',
          text: `Hi ${session.data.name}, your Airbnb container home in Livingston, Texas is booked from ${session.data.dates[0]} to ${session.data.dates[1] || session.data.dates[0]} for ${session.data.guests} guest(s). If you have any questions about your reservation, please call 936-328-1615.`,
        })
        .catch(err => {
          console.error('❌ Error sending confirmation email:', err.response?.data || err.message);
        })
        .finally(() => delete sessions[callSid]);
      return;
    } else if (negative) {
      session.step = 4;
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST', hints: 'gmail.com yahoo.com outlook.com hotmail.com icloud.com' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, 'Okay, please say your email address again.');
      return res.type('text/xml').send(twiml.toString());
    } else {
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `Please answer with yes or no. Is your email ${spellEmailForSpeech(session.data.email)}?`);
      return res.type('text/xml').send(twiml.toString());
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

function parseDateRange(text) {
  const months =
    'january|february|march|april|may|june|july|august|september|october|november|december';
  const re = new RegExp(
    `(?:from\\s+)?(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*(?:to|through|thru|until|till|-|\\u2013)\\s*(?:the\\s*)?(?:(${months})\\s+)?` +
      `(\\d{1,2})(?:st|nd|rd|th)?)?`,
    'i'
  );
  const m = text.toLowerCase().match(re);
  if (!m) return null;
  const startMonth = m[1];
  const startDay = m[2];
  const endMonth = m[3] || startMonth;
  const endDay = m[4];
  const start = `${startMonth} ${startDay}`;
  if (endDay) {
    const end = `${endMonth} ${endDay}`;
    return [start, end];
  }
  return [start];
}

function parseSpokenName(text) {
  let cleaned = text
    .toLowerCase()
    .replace(/(?:my\s+name\s+is|the\s+name\s+is|name\s+is|this\s+is|it's|it\s+is)\s*/g, '')
    .replace(/[.,?!]/g, ' ')
    .replace(/\b(spelled|spell|spelling)\b/g, '')
    .trim();

  if (!cleaned) return null;

  const rawTokens = cleaned.split(/\s+/).flatMap(tok => {
    if (/^[a-z](?:-[a-z])+$/i.test(tok)) {
      return tok.split('-');
    }
    return tok;
  });

  // Expand tokens like "c-a-r-r-i-e" into individual letters
  const expandedTokens = [];
  for (const tok of rawTokens) {
    if (tok.includes('-')) {
      const parts = tok.split('-');
      if (parts.every(p => /^[a-z]$/.test(p))) {
        expandedTokens.push(...parts);
        continue;
      }
    }
    expandedTokens.push(tok);
  }

  // Map common letter words and homophones to their single letter equivalent
  const letterMap = {
    a: 'a', ay: 'a',
    b: 'b', bee: 'b', be: 'b',
    c: 'c', cee: 'c', see: 'c', sea: 'c',
    d: 'd', dee: 'd',
    e: 'e', ee: 'e',
    f: 'f', ef: 'f', eff: 'f',
    g: 'g', gee: 'g',
    h: 'h', aitch: 'h',
    i: 'i', eye: 'i',
    j: 'j', jay: 'j',
    k: 'k', kay: 'k',
    l: 'l', el: 'l',
    m: 'm', em: 'm', emm: 'm',
    n: 'n', en: 'n',
    o: 'o', oh: 'o',
    p: 'p', pee: 'p',
    q: 'q', cue: 'q', queue: 'q',
    r: 'r', are: 'r',
    s: 's', ess: 's',
    t: 't', tee: 't',
    u: 'u', you: 'u',
    v: 'v', vee: 'v',
    w: 'w', 'doubleu': 'w', 'double-you': 'w',
    x: 'x', ex: 'x',
    y: 'y', why: 'y',
    z: 'z', zee: 'z', zed: 'z'
  };

  // Normalize tokens so sequences like "k a y" and "kay" both become "kay"
  const tokens = [];
  for (let i = 0; i < expandedTokens.length; i++) {
    let tok = expandedTokens[i];
    if (tok === 'double' && i + 1 < expandedTokens.length && (expandedTokens[i + 1] === 'u' || expandedTokens[i + 1] === 'you')) {
      tokens.push('doubleu');
      i += 1;
      continue;
    }
    if (i + 2 < expandedTokens.length && /^[a-z]$/.test(expandedTokens[i]) && /^[a-z]$/.test(expandedTokens[i + 1]) && /^[a-z]$/.test(expandedTokens[i + 2])) {
      const tri = expandedTokens[i] + expandedTokens[i + 1] + expandedTokens[i + 2];
      if (letterMap[tri]) {
        tok = tri;
        i += 2;
      }
    } else if (i + 1 < expandedTokens.length && /^[a-z]$/.test(expandedTokens[i]) && /^[a-z]$/.test(expandedTokens[i + 1])) {
      const duo = expandedTokens[i] + expandedTokens[i + 1];
      if (letterMap[duo]) {
        tok = duo;
        i += 1;
      }
    }
    tokens.push(tok);
  }

  const letters = [];
  const words = [];
  for (const tok of tokens) {
    const mapped = letterMap[tok] || tok;
    if (/^[a-z]$/.test(mapped)) {
      letters.push(mapped);
    } else {
      words.push(tok);
    }
  }

  const spelled = letters.join('');
  const namePart = words.join(' ');

  if (spelled && namePart) {
    if (namePart.replace(/\s+/g, '') === spelled) {
      return capitalizeWords(namePart);
    }
    return capitalizeWords(`${namePart} ${spelled}`);
  }

  if (spelled) return capitalizeWords(spelled);
  if (namePart) return capitalizeWords(namePart);

  return null;
}

function capitalizeWords(str) {
  return str
    .split(' ')
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function parseSpokenEmail(text) {
  const wordToLetter = {
    bee: 'b', cee: 'c', see: 'c', dee: 'd', eee: 'e', eff: 'f', gee: 'g',
    aitch: 'h', jay: 'j', kay: 'k', ell: 'l', em: 'm', en: 'n', oh: 'o',
    pee: 'p', cue: 'q', are: 'r', ess: 's', tee: 't', you: 'u', vee: 'v',
    doubleu: 'w', 'double-you': 'w', ex: 'x', why: 'y', zee: 'z', zed: 'z'
  };

  let cleaned = text
    .toLowerCase()
    .replace(/(?:my\s+email(?:\s+address)?\s+is|the\s+email(?:\s+address)?\s+is|email(?:\s+address)?\s+is|it's|it\s+is|this\s+is)[:\s]*/g, '')
    .replace(/[?!,]/g, ' ')
    .replace(/\s+at\s+/g, ' @ ')
    .replace(/\s+dot\s+/g, ' . ')
    .replace(/\s+underscore\s+/g, ' _ ')
    .replace(/\s+(?:dash|hyphen)\s+/g, ' - ')
    .trim();

  const tokens = cleaned.split(/\s+/);
  const parts = [];
  let letters = [];
  const pushLetters = () => {
    if (letters.length) {
      parts.push(letters.join(''));
      letters = [];
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'double' && i + 1 < tokens.length && (tokens[i + 1] === 'u' || tokens[i + 1] === 'you')) {
      letters.push('w');
      i += 1;
      continue;
    }
    const mapped = wordToLetter[t];
    if (mapped) {
      letters.push(mapped);
    } else if (/^[a-z]$/.test(t)) {
      letters.push(t);
    } else {
      pushLetters();
      parts.push(t);
    }
  }
  pushLetters();

  let result = '';
  const joiners = new Set(['@', '.', '_', '-']);
  for (const part of parts) {
    if (joiners.has(part)) {
      result += part;
    } else {
      if (result && !joiners.has(result.slice(-1))) result += ' ';
      result += part;
    }
  }

  result = result.trim();
  const match = result.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : result.replace(/\s+/g, '');
}

function spellEmailForSpeech(email) {
  return email
    .toLowerCase()
    .split('')
    .map(ch => {
      if (ch === '@') return 'at';
      if (ch === '.') return 'dot';
      if (ch === '_') return 'underscore';
      if (ch === '-') return 'dash';
      return ch;
    })
    .join(' ');
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Voice server running on port ${PORT}`);
  });
}

module.exports = {
  parseSpokenName,
  parseSpokenEmail,
  parseDate,
  parseDateRange,
  spellEmailForSpeech,
  app,
};
