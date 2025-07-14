const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/voice', (req, res) => {
  res.send('Voice endpoint is live.');
});

// Handle the incoming call
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/gather',
    method: 'POST',
    speechTimeout: 'auto'
  });

  gather.say(
    'Hello, this is your AI assistant for LW Wilson Container Homes. How can I help you today?',
    { voice: 'alice' }
  );

  twiml.redirect('/voice'); // fallback if no speech input

  res.type('text/xml');
  res.send(twiml.toString());
});

// Handle speech response
app.post('/gather', async (req, res) => {
  const userSpeech = req.body.SpeechResult || 'No speech detected.';
  console.log('🗣 User said:', userSpeech);

  const prompt = `You are a helpful and professional phone receptionist for a container home rental company. Reply clearly and concisely to the caller who said: "${userSpeech}"`;

  let reply = 'Sorry, I didn’t catch that. Can you repeat your question?';

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );
    reply = response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error.message);
  }

  const twiml = new VoiceResponse();
  twiml.say(reply, { voice: 'alice' });
  twiml.redirect('/voice');

  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Voice server running on port ${PORT}`));
