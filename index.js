const express = require('express');
const twilio = require('twilio');
const { OpenAI } = require('openai');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation history per call
const sessions = {};

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult;

  // Create new session if it doesn't exist
  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content: `
You are a friendly AI phone receptionist for a container home Airbnb in Livingston, Texas.
Your job is to collect the following booking details from the caller in a conversation:

1. Exact check-in and check-out dates
2. Number of guests
3. Confirm the final details before ending the call

Do not assume anything — always ask for missing details before confirming a booking.
Respond clearly and one step at a time.
        `,
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST',
    });
    gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
  } else {
    // Add user's message to session
    sessions[callSid].push({ role: 'user', content: userSpeech });

    // Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: sessions[callSid],
    });

    const aiReply = completion.choices[0].message.content;
    sessions[callSid].push({ role: 'assistant', content: aiReply });

    const gather = twiml.gather({
      input: 'speech',
      action: '/voice',
      method: 'POST',
    });
    gather.say(aiReply, { voice: 'alice' });
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
