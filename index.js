app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult;

  if (!sessions[callSid]) {
    sessions[callSid] = [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that helps users book Airbnb container homes in Livingston, Texas. Ask for check-in/out dates, number of guests, and the name for the reservation. Once all are received, confirm the booking. Do not ask if anything else is needed unless unclear.',
      },
    ];
  }

  if (!userSpeech) {
    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say('Hello, this is your AI phone assistant. How can I help you today?', { voice: 'alice' });
  } else {
    sessions[callSid].push({ role: 'user', content: userSpeech });

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: sessions[callSid],
    });

    const aiReply = completion.choices[0].message.content;
    sessions[callSid].push({ role: 'assistant', content: aiReply });

    // Extract booking details
    const dateRegex = /(\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(?:st|nd|rd|th)?)\b/gi;
    const guestRegex = /\b(\d+)\s+guests?\b/i;
    const nameRegex = /\b(?:guest name is|name is|for|under the name of|under the name)\s+([A-Z][a-z]+\s[A-Z][a-z]+)\b/;

    const dates = aiReply.match(dateRegex);
    const guestsMatch = userSpeech.match(guestRegex);
    const nameMatch = aiReply.match(nameRegex);

    const guests = guestsMatch ? guestsMatch[1] : null;
    const name = nameMatch ? nameMatch[1] : null;

    console.log('🧠 AI reply:', aiReply);
    console.log('📅 Dates:', dates);
    console.log('👥 Guests:', guests);
    console.log('🧑 Name:', name);

    if (dates && guests) {
      const event = {
        summary: `Booking for ${name && !name.toLowerCase().includes('providing') ? name : 'guest'} - ${guests} guests`,
        description: `Airbnb container home booking for ${name || 'guest'} via AI phone assistant.`,
        start: { date: parseDate(dates[0]), timeZone: 'America/Chicago' },
        end: { date: parseDate(dates[1] || dates[0]), timeZone: 'America/Chicago' },
      };
      try {
        const response = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event,
        });
        console.log('✅ Event created:', response.data);
      } catch (err) {
        console.error('❌ Calendar booking error:', err.response?.data || err.message);
      }
    }

    const gather = twiml.gather({ input: 'speech', action: '/voice', method: 'POST' });
    gather.say(aiReply, { voice: 'alice' });
  }

  res.type('text/xml');
  res.send(twiml.toString());
});
