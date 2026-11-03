// n8n Code node: "Debounce & Combine"
// Mode: Run Once for All Items
//
// Production replacement for twilio_buffer.js.
//
// Why: Twilio fires one webhook per SMS, and n8n starts one execution per
// webhook, so $input.all() inside a single execution only ever holds that one
// message. Aggregation therefore has to happen in shared state (the
// "eric_sms_buffer" n8n Data Table) instead of in memory.
//
// Flow before this node:
//   Webhook -> insert row into eric_sms_buffer -> Wait 15s -> get all buffered
//   rows for this sender (sorted ASC).
//
// Debounce rule: only the execution that owns the NEWEST buffered message for
// this phone number continues. Every earlier execution returns [] and stops,
// so the lead gets exactly one reply per burst of texts. The grouping/joining
// output shape matches twilio_buffer.js so downstream nodes see the same fields.

const config = $('Eric Config').first().json;
if (!config.ghlConversationProviderId) {
  throw new Error(
    'Eric Config.ghlConversationProviderId is empty. Create the GHL Custom SMS ' +
    'Conversation Provider (README step 2) and paste its ID into the Eric Config node.'
  );
}

const trigger = $('Twilio Inbound Webhook').first().json.body;
const mySid = trigger.MessageSid;

const rows = $input
  .all()
  .map((item) => item.json)
  .filter((row) => row && row.messageSid && row.phone === trigger.From)
  .sort((a, b) => Number(a.id) - Number(b.id));

if (rows.length === 0) {
  // Another execution already consumed and cleared this burst.
  return [];
}

const latest = rows[rows.length - 1];
if (latest.messageSid !== mySid) {
  // A newer text arrived inside the window; that execution will reply.
  return [];
}

const messages = rows
  .map((row) => (row.body || '').trim())
  .filter((body) => body.length > 0);

if (messages.length === 0) {
  return [];
}

return [
  {
    json: {
      phoneNumber: trigger.From,
      twilioNumber: trigger.To,
      combinedMessage: messages.join(' \n '),
      individualMessages: messages,
      messageCount: rows.length,
      messageSids: rows.map((row) => row.messageSid),
      lastMessageSid: mySid,
      maxBufferRowId: Number(latest.id),
      originalTwilioData: trigger,
      timestamp: new Date().toISOString(),
    },
  },
];
