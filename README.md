# ai-voice-server

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set the required environment variables:

   - `GOOGLE_SERVICE_ACCOUNT_BASE64` – base64 encoded Google service account JSON
   - `GOOGLE_CALENDAR_ID` – the calendar ID where bookings will be created
   - `TWILIO_ACCOUNT_SID` – your Twilio account SID
   - `TWILIO_AUTH_TOKEN` – your Twilio auth token
   - `TWILIO_PHONE_NUMBER` – the Twilio phone number used to send texts

   When a booking is confirmed, callers will be prompted to receive a confirmation text message sent from this number.

3. Start the server:

   ```bash
   npm start
   ```

## Running Tests

Run the unit tests with:

```bash
npm test
```
