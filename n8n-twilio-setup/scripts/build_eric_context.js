// n8n Code node: "Build Eric Context"
// Mode: Run Once for All Items
//
// Input: response of "GHL Get Conversation History"
//   (GET /conversations/{conversationId}/messages)
//
// Does three things:
//   1. Hard gate: if the contact is already tagged for manual review / opted
//      out, or has DND on, stop here so Eric never texts them again.
//   2. Deterministic opt-out detection (carrier keywords). Compliance must not
//      depend on the LLM remembering to emit [TRIGGER_HANDOFF].
//   3. Builds the transcript + new-message prompt that Eric receives.

const config = $('Eric Config').first().json;
const batch = $('Debounce & Combine').first().json;
const contact = $('GHL Upsert Contact').first().json.contact || {};
const inboundLog = $('GHL Log Inbound Message').first().json;

// ---- 1. Stop if a human already owns this lead ---------------------------
const tags = (contact.tags || []).map((t) => String(t).toLowerCase());
const blockedTags = [config.handoffTag, config.optOutTag].map((t) => t.toLowerCase());
if (contact.dnd === true || tags.some((t) => blockedTags.includes(t))) {
  return [];
}

// ---- 2. Deterministic opt-out keywords -----------------------------------
const OPT_OUT_EXACT = new Set([
  'stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit',
  'remove', 'remove me', 'opt out', 'optout', 'revoke',
]);
const OPT_OUT_PHRASE = /\b(unsubscribe|remove me|take me off|stop texting|stop messaging|opt[\s-]?out|do not (text|contact) me|don'?t (text|contact) me)\b/i;

const normalize = (s) => s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
const forcedOptOut =
  batch.individualMessages.some((m) => OPT_OUT_EXACT.has(normalize(m))) ||
  OPT_OUT_PHRASE.test(batch.combinedMessage);

// ---- 3. Transcript -------------------------------------------------------
const res = $input.first().json || {};
const rawMessages = Array.isArray(res.messages?.messages)
  ? res.messages.messages
  : Array.isArray(res.messages)
    ? res.messages
    : [];

const history = rawMessages
  .filter((m) => m && typeof m.body === 'string' && m.body.trim().length > 0)
  .filter((m) => m.id !== inboundLog.messageId) // the burst we just logged
  .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))
  .slice(-Number(config.historyLimit))
  .map((m) => `${m.direction === 'inbound' ? 'Lead' : 'Eric/Team'}: ${m.body.trim()}`);

const leadName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';

const userPrompt = [
  `Lead name: ${leadName}`,
  `Lead phone: ${batch.phoneNumber}`,
  '',
  'Conversation history (oldest first):',
  history.length > 0 ? history.join('\n') : '(no prior messages - this is the first contact)',
  '',
  `New message(s) from the lead (${batch.messageCount} text${batch.messageCount === 1 ? '' : 's'} received together):`,
  batch.combinedMessage,
  '',
  "Write Eric's next SMS reply only. No quotation marks, no labels, no sign-off.",
].join('\n');

return [
  {
    json: {
      userPrompt,
      forcedOptOut,
      contactId: contact.id,
      ghlConversationId: inboundLog.conversationId,
      phoneNumber: batch.phoneNumber,
      twilioNumber: batch.twilioNumber,
      lastMessageSid: batch.lastMessageSid,
    },
  },
];
