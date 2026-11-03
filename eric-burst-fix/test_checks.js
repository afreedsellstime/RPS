const fs = require('fs'); const assert = require('assert');
function run(file, { input, nodes, exec, runIndex = 0, now }) {
  const src = fs.readFileSync(require('path').join(__dirname, file), 'utf8');
  const $ = n => { if (!(n in nodes)) throw new Error('no node ' + n); const it = [].concat(nodes[n]).map(j => ({ json: j })); return { first: () => it[0], all: () => it }; };
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] };
  const RealDate = Date; const FakeDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  return new Function('$', '$input', '$execution', '$runIndex', 'Date', src)($, $input, { id: exec }, runIndex, FakeDate)[0].json;
}
const T0 = Date.parse('2026-10-30T21:10:30Z');
const msg = (id, dir, body, t, extra = {}) => ({ id, direction: dir, body, dateAdded: new Date(T0 + t * 1000).toISOString(), messageType: 'TYPE_SMS', ...extra });
const opener = msg('op', 'outbound', 'Hi Sergio this is Eric with RPS...', -113, { from: '+16193266282' });
const fsbo = msg('MDC', 'inbound', "It's on Zillow FSBO", -15);
const price = msg('qi5', 'inbound', '$2,995,000', -1.2);
const link = msg('Y2K', 'inbound', 'https://spiro.media/x', -1);
const conv = (...m) => ({ messages: { messages: m } });   // newest first
const ef = (text, recvOffset) => ({ inbound_text: text, received_at: new Date(T0 + recvOffset * 1000).toISOString(), turn_type: 'seller_message', tags: '' });
const claim = (text, exec) => ({ contact_id: 'c', inbound_text: text.trim().toLowerCase(), execution_id: String(exec) });
const claimsSergio = [claim("It's on Zillow FSBO", 1510), claim('$2,995,000', 1512)];   // no claim for the link: GHL never fired
let r, n = 0; const t = (name, f) => { f(); n++; console.log('PASS', name); };

t('Sergio inbound run for $2,995,000: link has no run -> waits, not stops', () => {
  r = run('debounce_check.js', { input: conv(link, price, fsbo, opener), nodes: { 'Edit Fields': ef('$2,995,000', 0), 'Get Claims': claimsSergio }, exec: 1512, now: T0 + 7500 });
  assert.equal(r.stop, false); assert.equal(r.refetch, true); assert.ok(r.wait_seconds >= 13 && r.wait_seconds <= 14, r.wait_seconds);
});
t('...after the 20s window it answers the whole burst', () => {
  r = run('debounce_check.js', { input: conv(link, price, fsbo, opener), nodes: { 'Edit Fields': ef('$2,995,000', 0), 'Get Claims': claimsSergio }, exec: 1512, runIndex: 1, now: T0 + 21000 });
  assert.equal(r.stop, false); assert.equal(r.refetch, false); assert.match(r.reason, /answers the whole burst/);
});
t('Sergio run for FSBO (if it saw the burst): stops because $2,995,000 has its own run', () => {
  r = run('debounce_check.js', { input: conv(link, price, fsbo, opener), nodes: { 'Edit Fields': ef("It's on Zillow FSBO", -13), 'Get Claims': claimsSergio }, exec: 1510, now: T0 });
  assert.equal(r.stop, true); assert.match(r.reason, /its own run/);
});
t('Outbound #1511 pre-send: newer $2,995,000 has its own run -> cancel, no reprocess (no double reply)', () => {
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(link, price, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: "Didn't realize it was up already." }, 'Get Claims (Pre-send)': claimsSergio }, exec: 1511, now: T0 + 110000 });
  assert.equal(r.send, false); assert.equal(r.reprocess, false); assert.match(r.reason, /its own run/);
});
t('Pre-send: seller texted again, GHL never fired for it -> re-read and answer', () => {
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(link, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'x' }, 'Get Claims (Pre-send)': [claim("It's on Zillow FSBO", 1510)] }, exec: 1511, now: T0 + 110000 });
  assert.equal(r.send, false); assert.equal(r.reprocess, true);
});
t('Pre-send: reprocess is capped after two re-reads', () => {
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(link, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'x' }, 'Get Claims (Pre-send)': [] }, exec: 1511, runIndex: 2, now: T0 });
  assert.equal(r.send, false); assert.equal(r.reprocess, false);
});
t('Pre-send: another reply already went out -> cancel', () => {
  const ours = msg('o2', 'outbound', 'Got it', 50, { from: '+16193266282' });
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(ours, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'x' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, false); assert.equal(r.reprocess, false); assert.match(r.reason, /already went out/);
});
t('Pre-send: a GHL activity note no longer cancels the reply', () => {
  const act = msg('a1', 'inbound', 'DnD enabled by customer', 40, { messageType: 'TYPE_ACTIVITY_CONTACT', type: 25 });
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(act, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'What has you looking to sell it?' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, true);
});
t('Pre-send: team member texted -> Eric stays off (unchanged)', () => {
  const team = msg('h', 'outbound', 'Hi this is Afreed', 40, { userId: 'eTbXNr9AEe7HyTfDUGNy', from: '+16193308056' });
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(team, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'x' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, false); assert.match(r.reason, /team member/);
});
t('Pre-send: duplicate reply guard unchanged', () => {
  const ours = msg('o2', 'outbound', 'Got it.', -20, { from: '+16193266282' });
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(fsbo, ours, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'Got it' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, false); assert.match(r.reason, /already sent/);
});
t('Barbara: "No" then "Stop" (+DnD note): Stop has its own run -> "No" run stops, never texts after STOP', () => {
  const no = msg('n', 'inbound', 'No', -11), stp = msg('s', 'inbound', 'Stop', 0), dnd = msg('d', 'inbound', 'DnD enabled by customer', 0.5, { messageType: 'TYPE_ACTIVITY_CONTACT', type: 25 });
  r = run('debounce_check.js', { input: conv(dnd, stp, no, opener), nodes: { 'Edit Fields': ef('No', -11), 'Get Claims': [claim('No', 1501), claim('Stop', 1502)] }, exec: 1501, now: T0 });
  assert.equal(r.stop, true);
});
t('Single text: no wait, answers normally', () => {
  r = run('debounce_check.js', { input: conv(fsbo, opener), nodes: { 'Edit Fields': ef("It's on Zillow FSBO", -13), 'Get Claims': [claim("It's on Zillow FSBO", 1510)] }, exec: 1510, now: T0 - 5000 });
  assert.equal(r.stop, false); assert.equal(r.refetch, false);
});
t('Already answered still stops', () => {
  const ours = msg('o2', 'outbound', 'Thanks', 5, { from: '+16193266282' });
  r = run('debounce_check.js', { input: conv(ours, fsbo, opener), nodes: { 'Edit Fields': ef("It's on Zillow FSBO", -13), 'Get Claims': [] }, exec: 1, now: T0 });
  assert.equal(r.stop, true); assert.match(r.reason, /already answered/);
});
t('Message not in GHL yet still refetches (2s)', () => {
  r = run('debounce_check.js', { input: conv(opener), nodes: { 'Edit Fields': ef("It's on Zillow FSBO", -13), 'Get Claims': [] }, exec: 1, now: T0 });
  assert.equal(r.refetch, true); assert.equal(r.wait_seconds, 2);
});
t('Claims table unreachable: behaves safely (waits, then answers)', () => {
  r = run('debounce_check.js', { input: conv(link, price, fsbo, opener), nodes: { 'Edit Fields': ef('$2,995,000', 0) }, exec: 1512, now: T0 + 7500 });
  assert.equal(r.refetch, true);
});
t('Follow-up turn types untouched', () => {
  r = run('debounce_check.js', { input: conv(link, price), nodes: { 'Edit Fields': { ...ef('', 0), turn_type: 'follow_up' }, 'Get Claims': [] }, exec: 1, now: T0 });
  assert.equal(r.stop, false); assert.equal(r.refetch, false);
});
t('Pre-send: snapshot was an activity note, nothing new since -> sends', () => {
  const act = msg('a1', 'inbound', 'DnD enabled by customer', -5, { messageType: 'TYPE_ACTIVITY_CONTACT', type: 25 });
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(act, fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'a1' }, 'AI Result': { reply: 'What has you looking to sell it?' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, true);
});
t('Pre-send: unchanged conversation sends', () => {
  r = run('presend_check.js', { nodes: { 'Pre-send Fetch': conv(fsbo, opener), 'Code in JavaScript': { snapshot_last_id: 'MDC' }, 'AI Result': { reply: 'What has you looking to sell it?' }, 'Get Claims (Pre-send)': [] }, exec: 1, now: T0 });
  assert.equal(r.send, true); assert.equal(r.reprocess, false);
});
console.log(`\n${n} passed`);
