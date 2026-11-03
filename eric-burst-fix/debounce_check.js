// Debounce Check (v2, Nov 4 2026): which run answers a burst of texts.
// GHL sometimes never fires a webhook for one of the texts in a burst. Every
// webhook run writes a "claim" (contact + text) into the eric_turn_claims table,
// so a run can tell whether a newer text actually has its own run.
//  - newer text that HAS its own run   -> stop, that run answers (as before)
//  - newer text with NO run yet         -> wait until 20s after this run started, check again
//  - still no run after 20s             -> this run answers the whole burst
// GHL activity notes (e.g. "DnD enabled by customer") are not texts and are ignored.
const resp = $input.first().json;
const raw = resp.messages?.messages || resp.messages || [];
const isText = m => !!(m && m.body && String(m.body).trim() && !String(m.messageType || '').startsWith('TYPE_ACTIVITY'));
const sms = raw.filter(isText);          // newest first
const ctx = $('Edit Fields').first().json;
const received = new Date(ctx.received_at).getTime();
const norm = s => String(s || '').trim().toLowerCase();
const want = norm(ctx.inbound_text);
const same = m => norm(m.body) === want;
const myExec = String($execution.id);
let claims = [];
try { claims = $('Get Claims').all().map(i => i.json).filter(c => c && c.inbound_text); } catch (e) { claims = []; }
const hasOwnRun = m => claims.some(c => c.inbound_text === norm(m.body) && String(c.execution_id) !== myExec);
const WINDOW_MS = 20000;
let stop = false, refetch = false, reason = '', wait_seconds = 2;

if (['seller_message', 'post_handoff'].includes(ctx.turn_type)) {
  const idx = want ? sms.findIndex(m => m.direction === 'inbound' && same(m)) : -1;
  const stored = !want || idx >= 0;
  const isOwn = want && sms.some(m => m.direction === 'outbound' && same(m));

  if (!stored && isOwn) {
    stop = true; reason = 'triggered by our own outgoing message';
  } else if (!stored) {
    if ($runIndex < 3) { refetch = true; reason = 'message not saved in GHL yet, fetching again'; }
    else { stop = true; reason = 'message never showed up'; }
  } else {
    // seller texts that came AFTER the one this run is answering
    const newer = idx >= 0
      ? sms.slice(0, idx).filter(m => m.direction === 'inbound')
      : sms.filter(m => m.direction === 'inbound' && new Date(m.dateAdded).getTime() > received);
    const elapsed = Date.now() - received;
    if (newer.length) {
      if (newer.some(hasOwnRun)) {
        stop = true; reason = 'newer inbound message, its own run will answer';
      } else if (elapsed < WINDOW_MS && $runIndex < 6) {
        refetch = true;
        wait_seconds = Math.max(2, Math.ceil((WINDOW_MS - elapsed) / 1000) + 1);
        reason = 'newer inbound has no run yet, waiting to see if one starts';
      } else {
        reason = 'newer inbound never got its own run, this run answers the whole burst';
      }
    } else if (sms[0] && sms[0].direction === 'outbound') {
      stop = true; reason = 'already answered';
    }
  }
}
return [{ json: { ...resp, stop, refetch, reason, wait_seconds } }];
