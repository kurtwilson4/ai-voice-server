const express = require('express');
const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const app = express();
app.use(express.urlencoded({ extended: false }));

// Handle GET for test
app.get('/voice', (req, res) => {
  res.send('Voice endpoint is live. Use POST to interact.');
});

// Handle POST for Twilio
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
  res.type('text/xml');
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Voice server running on port ${PORT}`);
});
