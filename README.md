# ai-voice-server

When providing your email address during a call, speak it using words like
"at", "dot", "underscore" or "dash". For example:

```
john dot doe at gmail dot com
```

The system will normalize these phrases to a proper email address when it
detects a match.

When a call begins you'll be asked for your check-in and check-out dates so the
system can collect your booking details.

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set the required environment variables:

   - `GOOGLE_SERVICE_ACCOUNT_BASE64` – base64 encoded Google service account JSON
   - `GOOGLE_CALENDAR_ID` – the calendar ID where bookings will be created
   - `EMAIL_PASS` – password for the email account used to send confirmations
   - `EMAIL_USER` *(optional)* – sender email address (defaults to `lwwilsoncontainerhomes@gmail.com`)

3. Start the server:

   ```bash
   npm start
   ```

## Running Tests

Run the unit tests with:

```bash
npm test
```
