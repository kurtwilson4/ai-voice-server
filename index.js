const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const VoiceResponse = twilio.twiml.VoiceResponse;
const app = express();
app.use(express.urlencoded({ extended: false }));

// Initialize OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Handle Twilio Voice webhook
app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const userSpeech = req.body.SpeechResult || '';

  let aiReply = 'I’m sorry, I didn’t catch that. Can you say it again?';

  if (userSpeech) {
    try {
      const completion = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: userSpeech }],
      });

      aiReply = completion.data.choices[0].message.content.trim();
    } catch (error) {
      console.error('OpenAI error:', error);
    }
  }

  twiml.say({ voice: 'alice' }, aiReply);
  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
