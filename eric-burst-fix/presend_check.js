// Pre-send Check (v2, Nov 4 2026). Same checks as before, plus: if the seller texted
// again while Eric was thinking and GHL never started a run for that text, go back and
// answer everything instead of going silent. GHL activity notes are not texts.
const resp = $('Pre-send Fetch').first().json;
const raw = resp.messages?.messages || resp.messages || [];
const isText = m => !!(m && m.body && String(m.body).trim() && !String(m.messageType || '').startsWith('TYPE_ACTIVITY'));
const withBody = raw.filter(m => m && m.body && String(m.body).trim());   // same list the snapshot was taken from
const sms = withBody.filter(isText);                                      // newest first, real texts only
const snap = $('Code in JavaScript').first().json.snapshot_last_id;
const reply = $('AI Result').first().json.reply || '';
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const normClaim = s => String(s || '').trim().toLowerCase();
const myExec = String($execution.id);
let claims = [];
try { claims = $('Get Claims (Pre-send)').all().map(i => i.json).filter(c => c && c.inbound_text); } catch (e) { claims = []; }
const hasOwnRun = m => claims.some(c => c.inbound_text === normClaim(m.body) && String(c.execution_id) !== myExec);

const ERIC_NUMBER = '+16193266282';
const humanTouch = raw.some(m => m && (m.type === 1 || m.messageType === 'TYPE_CALL' || (m.direction === 'outbound' && (m.userId || (m.from && m.from !== ERIC_NUMBER)))));

let newer = [];
if (snap && withBody[0] && withBody[0].id !== snap) {
  const snapIdx = withBody.findIndex(m => m.id === snap);
  newer = (snapIdx >= 0 ? withBody.slice(0, snapIdx) : withBody.slice(0, 1)).filter(isText);
}

let send = true, reason = '', reprocess = false;
if (humanTouch) {
  send = false; reason = 'a team member has called or texted this seller, Eric stays off';
} else if (newer.length) {
  send = false;
  if (newer.some(m => m.direction !== 'inbound')) {
    reason = 'conversation changed while thinking (a reply already went out), not sending';
  } else if (newer.some(hasOwnRun)) {
    reason = 'seller texted again while thinking, that text has its own run which will answer';
  } else if ($runIndex < 2) {
    reprocess = true;
    reason = 'seller texted again while thinking and no run picked it up, re-reading the conversation to answer everything';
  } else {
    reason = 'seller kept texting while thinking, stopped after re-reading twice';
  }
} else if (sms.filter(m => m.direction === 'outbound').slice(0, 3).some(m => norm(m.body) === norm(reply))) {
  send = false; reason = 'same text was already sent';
}
return [{ json: { send, reason, reprocess } }];
