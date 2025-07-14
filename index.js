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

app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    if (!req.body.SpeechResult) {
      const gather = twiml.gather({
        input: 'speech',
        action: '/voice',
        method: 'POST',
      });
      gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
    } else {
      const userInput = req.body.SpeechResult;
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful AI phone receptionist for a container home Airbnb in Livingston, Texas. Keep the conversation going naturally until the guest is done.' },
          { role: 'user', content: userInput },
        ],
      });

      const aiReply = completion.choices[0].message.content;

      const gather = twiml.gather({
        input: 'speech',
        action: '/voice',
        method: 'POST',
      });
      gather.say(aiReply + ' Is there anything else I can help you with?', { voice: 'alice' });
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error('Error:', error);
    twiml.say('Sorry, something went wrong. Please try again later.', { voice: 'alice' });
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
