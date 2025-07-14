const express = require("express");
const { google } = require("googleapis");
const dotenv = require("dotenv");
const twilio = require("twilio");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Twilio setup
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// OpenAI setup
const openai = new OpenAI.OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Root route for Render to verify
app.get("/", (req, res) => {
  res.send("AI Voice Server is running");
});

// Twilio voice webhook
app.post("/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const userSpeech = req.body.SpeechResult || "No speech detected";
  const prompt = `Act like a professional booking assistant for a container home Airbnb. Here's what the guest said: "${userSpeech}". Respond naturally and ask follow-up questions if needed.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    const reply = completion.choices[0].message.content;
    twiml.say(reply);
    twiml.redirect("/voice");

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("OpenAI error:", err);
    twiml.say("Sorry, I had trouble responding. Please try again.");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// Booking endpoint (future use)
app.post("/book", async (req, res) => {
  res.send("Booking logic will go here");
});

app.listen(port, () => {
  console.log(`✅ AI Voice server running on port ${port}`);
});
