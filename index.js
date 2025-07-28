const express = require('express');
const twilio = require('twilio');
const { google } = require('googleapis');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const smsFrom = process.env.TWILIO_PHONE_NUMBER;
const smsClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

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
const letterHints = 'a b c d e f g h i j k l m n o p q r s t u v w x y z';

function endSession(callSid) {
  const session = sessions[callSid];
  if (session && session.cleanup) clearTimeout(session.cleanup);
  delete sessions[callSid];
}

async function finalizeBooking(session) {
  const [startDate, endDate] = session.data.dates;

  const isoStart = parseDate(startDate);
  const isoEnd = parseDate(endDate || startDate);
  if (!isoStart || !isoEnd) {
    throw new Error('Invalid date');
  }
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
function sendTextConfirmation(to, name, startDate, endDate, guests) {
  if (!smsClient || !smsFrom || !to) return;
  smsClient.messages.create({
    body: `Your reservation for ${name} from ${startDate} to ${endDate} for ${guests} guests is confirmed.`,
    from: smsFrom,
    to,
  }).catch(err => {
    console.error("Error sending confirmation SMS:", err.message);
  });
}


app.post('/voice', async (req, res, next) => {
  try {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid;
    const userSpeech = req.body.SpeechResult;
    const callerNumber = req.body.From;

  if (!sessions[callSid]) {
    sessions[callSid] = {
      step: 0,
      data: {},
      cleanup: setTimeout(() => endSession(callSid), 30 * 60 * 1000),
    };
  }
    const session = sessions[callSid];

  const ask = (text, hints) => {
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST',
      timeout: 6,
      speechTimeout: 'auto',
      ...(hints ? { hints } : {}),
    });
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
      if (!isoStart || !isoEnd) {
        return ask("I couldn't understand those dates. Could you repeat the check-in and check-out dates?");
      }

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
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `I heard your name as ${spellNameForSpeech(session.data.name)}. Is that correct? Please say yes or no.`);
      session.step = 3;
      return res.type('text/xml').send(twiml.toString());
    } else {
      session.step = 4;
      return ask("I didn't quite get the name. Can you please spell it out?", letterHints);
    }
  }

  // Step 3: Confirm Name
  else if (session.step === 3) {
    const positive = /\b(yes|correct|yeah)\b/i.test(userSpeech);
    const negative = /\b(no|incorrect|nah)\b/i.test(userSpeech);
    if (positive) {
      try {
        const { startDate, endDate } = await finalizeBooking(session);
        sendTextConfirmation(callerNumber, session.data.name, startDate, endDate, session.data.guests);
        twiml.say({
          voice: 'Google.en-US-Wavenet-D',
          language: 'en-US',
        }, `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate} for ${session.data.guests} guests is confirmed. Goodbye.`);
        endSession(callSid);
        return res.type('text/xml').send(twiml.toString());
      } catch (err) {
        console.error('❌ Error creating calendar event:', err.response?.data || err.message);
        twiml.say('Something went wrong while trying to book your reservation. Please try again later.');
        endSession(callSid);
        return res.type('text/xml').send(twiml.toString());
      }
    } else if (negative) {
      session.step = 4;
      return ask('Okay, please spell your name.', letterHints);
    } else {
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `Please answer with yes or no. Is your name ${spellNameForSpeech(session.data.name)}?`);
      return res.type('text/xml').send(twiml.toString());
    }
  }

  // Step 4: Handle Spelled Name
  else if (session.step === 4) {
    const spelledName = parseSpokenName(userSpeech);
    if (spelledName) {
      session.data.name = spelledName;
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `I understood your name as ${spellNameForSpeech(session.data.name)}. Is that correct? Please say yes or no.`);
      session.step = 5;
      return res.type('text/xml').send(twiml.toString());
    } else {
      return ask("Sorry, I still didn’t catch that. Please try spelling the name again.", letterHints);
    }
  }

  // Step 5: Confirm Spelled Name
  else if (session.step === 5) {
    const positive = /\b(yes|correct|yeah)\b/i.test(userSpeech);
    const negative = /\b(no|incorrect|nah)\b/i.test(userSpeech);
    if (positive) {
      try {
        const { startDate, endDate } = await finalizeBooking(session);
        sendTextConfirmation(callerNumber, session.data.name, startDate, endDate, session.data.guests);
        twiml.say({
          voice: 'Google.en-US-Wavenet-D',
          language: 'en-US',
        }, `Thank you, ${session.data.name}. Your reservation for the container home in Livingston, Texas from ${startDate} to ${endDate} for ${session.data.guests} guests is confirmed. Goodbye.`);
        endSession(callSid);
        return res.type('text/xml').send(twiml.toString());
      } catch (err) {
        console.error('❌ Error creating calendar event:', err.response?.data || err.message);
        twiml.say('Something went wrong while trying to book your reservation. Please try again later.');
        endSession(callSid);
        return res.type('text/xml').send(twiml.toString());
      }
    } else if (negative) {
      session.step = 4;
      return ask('Okay, please spell your name again.', letterHints);
    } else {
      const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
      gather.say({ voice: 'Google.en-US-Wavenet-D', language: 'en-US' }, `Please answer with yes or no. Is your name ${spellNameForSpeech(session.data.name)}?`);
      return res.type('text/xml').send(twiml.toString());
    }
  }



    res.type('text/xml');
  res.send(twiml.toString());
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const twiml = new VoiceResponse();
  twiml.say('An unexpected error occurred. Please try again later.');
  res.type('text/xml').send(twiml.toString());
});

function normalizeOrdinals(text) {
  const map = {
    first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
    sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
    eleventh: '11', twelfth: '12', thirteenth: '13', fourteenth: '14',
    fifteenth: '15', sixteenth: '16', seventeenth: '17', eighteenth: '18',
    nineteenth: '19', twentieth: '20',
    'twenty first': '21', 'twenty-first': '21',
    'twenty second': '22', 'twenty-second': '22',
    'twenty third': '23', 'twenty-third': '23',
    'twenty fourth': '24', 'twenty-fourth': '24',
    'twenty fifth': '25', 'twenty-fifth': '25',
    'twenty sixth': '26', 'twenty-sixth': '26',
    'twenty seventh': '27', 'twenty-seventh': '27',
    'twenty eighth': '28', 'twenty-eighth': '28',
    'twenty ninth': '29', 'twenty-ninth': '29',
    thirtieth: '30',
    'thirty first': '31', 'thirty-first': '31',
  };
  const patterns = Object.keys(map)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/ /g, '\\s+'));
  const regex = new RegExp(`\\b(${patterns.join('|')})\\b`, 'gi');
  return text.replace(regex, m => map[m.toLowerCase().replace(/\\s+/g, ' ')]);
}

function parseDate(str) {
  if (!str) return null;
  const clean = normalizeOrdinals(str.toLowerCase()).replace(/(st|nd|rd|th)/g, '');
  const [monthName, dayStr] = clean.split(/\s+/);
  const day = parseInt(dayStr, 10);
  if (!monthName || Number.isNaN(day)) return null;

  const temp = new Date(`${monthName} 1, 2000`);
  if (Number.isNaN(temp.getTime())) return null;
  const month = temp.getUTCMonth();

  const now = new Date();
  let year = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    year += 1; // assume booking for next year if date has already passed
  }

  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return null;

  return date.toISOString().slice(0, 10);
}

function parseDateRange(text) {
  const months =
    'january|february|march|april|may|june|july|august|september|october|november|december';
  const normalized = normalizeOrdinals(text.toLowerCase());
  const re = new RegExp(
    `(?:from\\s+)?(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
      `(?:\\s*(?:to|through|thru|until|till|-|\\u2013)\\s*(?:the\\s*)?(?:(${months})\\s+)?` +
      `(\\d{1,2})(?:st|nd|rd|th)?)?`,
    'i'
  );
  const m = normalized.match(re);
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
    .replace(
      /(?:my\s+name\s+is|the\s+name\s+is|name\s+is|the\s+name\s+(?:for\s+(?:the\s+)?(?:reservation|booking)|on\s+(?:the\s+)?(?:reservation|booking))\s+is|the\s+(?:reservation|booking)\s+is\s+under|this\s+is|it's|it\s+is)\s*/g,
      ''
    )
    .replace(/[.,?!]/g, ' ')
    .replace(/\b(spelled|spell|spelling)\b/g, '')
    .trim();

  if (!cleaned) return null;

  const filler = /^(?:yes|yeah|yep|yup|okay|ok|sure|no|i\s+don'?t\s+know|don't\s+know|not\s+sure|unknown|n\/?a|uh|um)$/i;
  if (filler.test(cleaned)) return null;

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


function spellNameForSpeech(name) {
  return name
    .replace(/\s+/g, '')
    .split('')
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
  parseDate,
  parseDateRange,
  spellNameForSpeech,
  app,
};
