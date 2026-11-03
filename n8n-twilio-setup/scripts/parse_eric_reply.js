// n8n Code node: "Parse Eric Reply"
// Mode: Run Once for All Items
//
// Input: output of the "Eric (Claude)" Anthropic node.
// Output fields consumed downstream:
//   ericReplyText     - SMS text with the [TRIGGER_HANDOFF] flag removed
//   handoff           - true -> tag contact for manual review in GHL
//   optOut            - true -> also tag opt-out + set SMS DND in GHL
//   sendReply         - true -> send ericReplyText via Twilio and log to GHL
//   handoffTags       - tags to add to the GHL contact
//   ghlConversationId, contactId, phoneNumber, twilioNumber

const HANDOFF_FLAG = '[TRIGGER_HANDOFF]';

const config = $('Eric Config').first().json;
const ctx = $('Build Eric Context').first().json;
const res = $input.first().json || {};

// The Anthropic node returns either a merged string or a content-block array.
let raw = '';
if (typeof res.merged_response === 'string') {
  raw = res.merged_response;
} else if (Array.isArray(res.content)) {
  raw = res.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
} else if (typeof res.text === 'string') {
  raw = res.text;
}

const modelHandoff = raw.includes(HANDOFF_FLAG);
const optOut = ctx.forcedOptOut === true;
const handoff = modelHandoff || optOut;

const ericReplyText = raw
  .split(HANDOFF_FLAG).join('')
  .replace(/^\s*(Eric|Eric\/Team)\s*:\s*/i, '')
  .replace(/^["'“”]+|["'“”]+$/g, '')
  .trim();

if (!handoff && ericReplyText.length === 0) {
  throw new Error('Eric returned an empty reply without a handoff flag. Raw response: ' + JSON.stringify(res));
}

const handoffTags = [];
if (handoff) handoffTags.push(config.handoffTag);
if (optOut) handoffTags.push(config.optOutTag);

return [
  {
    json: {
      ericReplyText,
      handoff,
      optOut,
      // Never text an opted-out number. A non-opt-out handoff may still send
      // Eric's short acknowledgement (e.g. "Got it, looping in a teammate.").
      sendReply: !optOut && ericReplyText.length > 0,
      handoffTags,
      ghlConversationId: ctx.ghlConversationId,
      contactId: ctx.contactId,
      phoneNumber: ctx.phoneNumber,
      twilioNumber: ctx.twilioNumber,
    },
  },
];
