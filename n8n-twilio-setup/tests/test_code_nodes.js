#!/usr/bin/env node
// Runs the n8n Code node scripts outside n8n with mocked $() / $input.
//   node tests/test_code_nodes.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function runCodeNode(file, { nodes, input }) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Unmocked node reference: ${name}`);
    const items = [].concat(nodes[name]).map((json) => ({ json }));
    return { first: () => items[0], all: () => items, item: items[0] };
  };
  const $input = {
    all: () => input.map((json) => ({ json })),
    first: () => ({ json: input[0] }),
  };
  const fn = new Function('$', '$input', `return (async () => {\n${src}\n})();`);
  return fn($, $input);
}

const config = {
  ghlLocationId: '8C8ciDyrhieAxq70pn1I',
  ghlConversationProviderId: 'prov123',
  handoffTag: 'eric-manual-review',
  optOutTag: 'sms-opt-out',
  historyLimit: 20,
};
const LEAD = '+15551230001';
const OUR = '+15559990000';
const webhook = (sid) => ({ body: { From: LEAD, To: OUR, MessageSid: sid, Body: 'x' } });
const rows = [
  { id: 11, phone: LEAD, body: 'hey', messageSid: 'SM1', toNumber: OUR },
  { id: 12, phone: LEAD, body: ' are you there? ', messageSid: 'SM2', toNumber: OUR },
  { id: 13, phone: LEAD, body: 'need a quote', messageSid: 'SM3', toNumber: OUR },
];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------- Debounce & Combine --
test('debounce: newest execution combines the whole burst', async () => {
  const out = await runCodeNode('scripts/debounce_combine.js', {
    nodes: { 'Eric Config': config, 'Twilio Inbound Webhook': webhook('SM3') },
    input: [rows[2], rows[0], rows[1]],
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.combinedMessage, 'hey \n are you there? \n need a quote');
  assert.strictEqual(out[0].json.maxBufferRowId, 13);
  assert.deepStrictEqual(out[0].json.messageSids, ['SM1', 'SM2', 'SM3']);
});

test('debounce: older executions in the burst stop', async () => {
  for (const sid of ['SM1', 'SM2']) {
    const out = await runCodeNode('scripts/debounce_combine.js', {
      nodes: { 'Eric Config': config, 'Twilio Inbound Webhook': webhook(sid) },
      input: rows,
    });
    assert.deepStrictEqual(out, []);
  }
});

test('debounce: empty buffer (already consumed) stops', async () => {
  const out = await runCodeNode('scripts/debounce_combine.js', {
    nodes: { 'Eric Config': config, 'Twilio Inbound Webhook': webhook('SM3') },
    input: [{}],
  });
  assert.deepStrictEqual(out, []);
});

test('debounce: missing conversation provider id fails loudly', async () => {
  await assert.rejects(
    runCodeNode('scripts/debounce_combine.js', {
      nodes: { 'Eric Config': { ...config, ghlConversationProviderId: '' }, 'Twilio Inbound Webhook': webhook('SM3') },
      input: rows,
    }),
    /ghlConversationProviderId is empty/,
  );
});

// ---------------------------------------------------- Build Eric Context --
const batch = (msgs) => ({
  phoneNumber: LEAD, twilioNumber: OUR, combinedMessage: msgs.join(' \n '),
  individualMessages: msgs, messageCount: msgs.length, lastMessageSid: 'SM3',
});
const ghlHistory = {
  messages: {
    messages: [
      { id: 'm3', direction: 'inbound', body: 'hey \n need a quote', dateAdded: '2026-11-03T10:02:00Z' },
      { id: 'm2', direction: 'outbound', body: 'Hi! This is Eric.', dateAdded: '2026-11-03T10:01:00Z' },
      { id: 'm1', direction: 'inbound', body: 'hello', dateAdded: '2026-11-03T10:00:00Z' },
    ],
  },
};
const ctxNodes = (msgs, contact = {}) => ({
  'Eric Config': config,
  'Debounce & Combine': batch(msgs),
  'GHL Upsert Contact': { contact: { id: 'c1', firstName: 'Dana', tags: [], ...contact } },
  'GHL Log Inbound Message': { conversationId: 'conv1', messageId: 'm3' },
});

test('context: builds ordered transcript and excludes the just-logged burst', async () => {
  const [out] = await runCodeNode('scripts/build_eric_context.js', {
    nodes: ctxNodes(['hey', 'need a quote']),
    input: [ghlHistory],
  });
  const p = out.json.userPrompt;
  assert.ok(p.indexOf('Lead: hello') < p.indexOf('Eric/Team: Hi! This is Eric.'));
  assert.ok(!p.includes('Lead: hey \n need a quote'));
  assert.ok(p.includes('Lead name: Dana'));
  assert.strictEqual(out.json.forcedOptOut, false);
  assert.strictEqual(out.json.ghlConversationId, 'conv1');
});

test('context: STOP keyword forces opt-out', async () => {
  for (const msgs of [['STOP'], ['ok', 'Stop.'], ['please remove me from this list']]) {
    const [out] = await runCodeNode('scripts/build_eric_context.js', {
      nodes: ctxNodes(msgs),
      input: [ghlHistory],
    });
    assert.strictEqual(out.json.forcedOptOut, true, JSON.stringify(msgs));
  }
});

test('context: "can you stop by tomorrow" is NOT an opt-out', async () => {
  const [out] = await runCodeNode('scripts/build_eric_context.js', {
    nodes: ctxNodes(['can you stop by tomorrow']),
    input: [ghlHistory],
  });
  assert.strictEqual(out.json.forcedOptOut, false);
});

test('context: contact already in manual review gets no automated reply', async () => {
  const out = await runCodeNode('scripts/build_eric_context.js', {
    nodes: ctxNodes(['hello?'], { tags: ['Eric-Manual-Review'] }),
    input: [ghlHistory],
  });
  assert.deepStrictEqual(out, []);
});

test('context: contact with DND gets no automated reply', async () => {
  const out = await runCodeNode('scripts/build_eric_context.js', {
    nodes: ctxNodes(['hello?'], { dnd: true }),
    input: [ghlHistory],
  });
  assert.deepStrictEqual(out, []);
});

// ------------------------------------------------------ Parse Eric Reply --
const parseNodes = (forcedOptOut = false) => ({
  'Eric Config': config,
  'Build Eric Context': { forcedOptOut, contactId: 'c1', ghlConversationId: 'conv1', phoneNumber: LEAD, twilioNumber: OUR },
});

test('parse: normal reply is sent', async () => {
  const [out] = await runCodeNode('scripts/parse_eric_reply.js', {
    nodes: parseNodes(),
    input: [{ merged_response: 'Happy to help. What size job is it?' }],
  });
  assert.strictEqual(out.json.sendReply, true);
  assert.strictEqual(out.json.handoff, false);
  assert.strictEqual(out.json.ericReplyText, 'Happy to help. What size job is it?');
});

test('parse: content-block response shape is supported', async () => {
  const [out] = await runCodeNode('scripts/parse_eric_reply.js', {
    nodes: parseNodes(),
    input: [{ content: [{ type: 'text', text: 'Sure thing.' }] }],
  });
  assert.strictEqual(out.json.ericReplyText, 'Sure thing.');
});

test('parse: [TRIGGER_HANDOFF] tags for review and strips the flag', async () => {
  const [out] = await runCodeNode('scripts/parse_eric_reply.js', {
    nodes: parseNodes(),
    input: [{ merged_response: '[TRIGGER_HANDOFF] Got it, looping in a teammate now.' }],
  });
  assert.strictEqual(out.json.handoff, true);
  assert.strictEqual(out.json.optOut, false);
  assert.strictEqual(out.json.sendReply, true);
  assert.strictEqual(out.json.ericReplyText, 'Got it, looping in a teammate now.');
  assert.deepStrictEqual(out.json.handoffTags, ['eric-manual-review']);
});

test('parse: opt-out never sends, even if Eric wrote text', async () => {
  const [out] = await runCodeNode('scripts/parse_eric_reply.js', {
    nodes: parseNodes(true),
    input: [{ merged_response: 'No problem, removing you now!' }],
  });
  assert.strictEqual(out.json.handoff, true);
  assert.strictEqual(out.json.optOut, true);
  assert.strictEqual(out.json.sendReply, false);
  assert.deepStrictEqual(out.json.handoffTags, ['eric-manual-review', 'sms-opt-out']);
});

test('parse: flag-only handoff sends nothing', async () => {
  const [out] = await runCodeNode('scripts/parse_eric_reply.js', {
    nodes: parseNodes(),
    input: [{ merged_response: '[TRIGGER_HANDOFF]' }],
  });
  assert.strictEqual(out.json.handoff, true);
  assert.strictEqual(out.json.sendReply, false);
});

test('parse: empty reply without handoff throws', async () => {
  await assert.rejects(
    runCodeNode('scripts/parse_eric_reply.js', { nodes: parseNodes(), input: [{ merged_response: '  ' }] }),
    /empty reply/,
  );
});

// ------------------------------------------------- workflow JSON integrity --
test('workflow: every connection points at an existing node', async () => {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows/eric_twilio_sms_workflow.json'), 'utf8'));
  const names = new Set(wf.nodes.map((n) => n.name));
  assert.strictEqual(names.size, wf.nodes.length, 'duplicate node names');
  for (const [src, conn] of Object.entries(wf.connections)) {
    assert.ok(names.has(src), `unknown source ${src}`);
    for (const branch of conn.main) for (const t of branch) assert.ok(names.has(t.node), `unknown target ${t.node}`);
  }
  const referenced = new Set();
  const json = JSON.stringify(wf.nodes);
  for (const m of json.matchAll(/\$\('([^']+)'\)/g)) referenced.add(m[1]);
  for (const ref of referenced) assert.ok(names.has(ref), `expression references missing node ${ref}`);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${name}\n      ${err.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
