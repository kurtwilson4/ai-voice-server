const express = require("express");
const { google } = require("googleapis");
const dotenv = require("dotenv");
const twilio = require("twilio");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

// ✅ Root route to confirm server is live
app.get("/", (req, res) => {
  res.send("AI Voice Server is running");
});

// Example placeholder for booking (you can customize this later)
app.post("/book", async (req, res) => {
  res.send("Booking logic will go here");
});

app.listen(port, () => {
  console.log(`AI Voice server running on port ${port}`);
});
