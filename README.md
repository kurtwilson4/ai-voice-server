# ai-voice-server

When a call begins you'll first be asked which property you want to book—the
**Jalapeno** or **The Bluebonnet**. Respond with the property name so the system
can continue with collecting your dates and other details.

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set the required environment variables:

   - `GOOGLE_SERVICE_ACCOUNT_BASE64` – base64 encoded Google service account JSON
   - `GOOGLE_CALENDAR_ID` – the calendar ID where bookings will be created

3. Start the server:

   ```bash
   npm start
   ```

## Running Tests

Run the unit tests with:

```bash
npm test
```
