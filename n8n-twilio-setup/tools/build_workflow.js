#!/usr/bin/env node
// Generates workflows/eric_twilio_sms_workflow.json from the source files in
// scripts/ and prompts/. Run after editing any Code node script or the prompt:
//   node tools/build_workflow.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = '8C8ciDyrhieAxq70pn1I';
const CONTACTS_API_VERSION = '2021-07-28';
const CONVERSATIONS_API_VERSION = '2021-04-15';
const ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const BUFFER_TABLE = 'eric_sms_buffer';

const WH = "$('Twilio Inbound Webhook').item.json.body";
const CFG = "$('Eric Config').first().json";

const systemPrompt = read('prompts/eric_system_prompt.txt').trim();

// ---------------------------------------------------------------- helpers --
let idCounter = 0;
const uid = (prefix) => `${prefix}-${String(++idCounter).padStart(4, '0')}`;

const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

function ghlRequest({ name, position, method, url, apiVersion, jsonBody, query }) {
  const parameters = {
    method,
    url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Version', value: apiVersion },
        { name: 'Accept', value: 'application/json' },
      ],
    },
    options: {},
  };
  if (query) {
    parameters.sendQuery = true;
    parameters.queryParameters = { parameters: query };
  }
  if (jsonBody) {
    parameters.sendBody = true;
    parameters.specifyBody = 'json';
    parameters.jsonBody = jsonBody;
  }
  return {
    id: uid('ghl'),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters,
    ...retry,
  };
}

function booleanIf({ name, position, leftValue }) {
  return {
    id: uid('if'),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: uid('cond'),
            leftValue,
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  };
}

const codeNode = (name, position, file) => ({
  id: uid('code'),
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: read(file) },
});

const tableCol = (id) => ({
  id,
  displayName: id,
  required: false,
  defaultMatch: false,
  display: true,
  type: 'string',
  canBeUsedToMatch: true,
});

// ------------------------------------------------------------------ nodes --
const nodes = [
  {
    id: uid('trigger'),
    name: 'Twilio Inbound Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 300],
    webhookId: '6f0c2a7e-3b1d-4c8e-9a51-2e7d4b9c1f30',
    parameters: {
      httpMethod: 'POST',
      path: 'twilio/eric-inbound-sms',
      responseMode: 'responseNode',
      options: {},
    },
  },
  {
    id: uid('respond'),
    name: 'Ack Twilio (Empty TwiML)',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [220, 300],
    parameters: {
      respondWith: 'text',
      responseBody: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      options: {
        responseCode: 200,
        responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/xml' }] },
      },
    },
  },
  {
    id: uid('set'),
    name: 'Eric Config',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [440, 300],
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: uid('cfg'), name: 'ghlLocationId', value: GHL_LOCATION_ID, type: 'string' },
          { id: uid('cfg'), name: 'ghlConversationProviderId', value: '', type: 'string' },
          { id: uid('cfg'), name: 'handoffTag', value: 'eric-manual-review', type: 'string' },
          { id: uid('cfg'), name: 'optOutTag', value: 'sms-opt-out', type: 'string' },
          { id: uid('cfg'), name: 'historyLimit', value: 20, type: 'number' },
        ],
      },
      options: {},
    },
  },
  {
    id: uid('table'),
    name: 'Buffer Inbound SMS',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [660, 300],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: BUFFER_TABLE },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          phone: `={{ ${WH}.From }}`,
          body: `={{ ${WH}.Body ? ${WH}.Body : (Number(${WH}.NumMedia) > 0 ? '[Sent ' + ${WH}.NumMedia + ' photo/media attachment(s)]' : '') }}`,
          messageSid: `={{ ${WH}.MessageSid }}`,
          toNumber: `={{ ${WH}.To }}`,
        },
        matchingColumns: [],
        schema: ['phone', 'body', 'messageSid', 'toNumber'].map(tableCol),
      },
      options: {},
    },
    ...retry,
  },
  {
    id: uid('wait'),
    name: 'Wait 15s (Rapid-Fire Window)',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [880, 300],
    webhookId: 'b2e94f1a-7c3d-4e6b-8f20-5a1c9d7e3b42',
    parameters: { resume: 'timeInterval', amount: 15, unit: 'seconds' },
  },
  {
    id: uid('table'),
    name: 'Get Buffered Messages',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [1100, 300],
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: BUFFER_TABLE },
      matchType: 'allConditions',
      filters: {
        conditions: [{ keyName: 'phone', condition: 'eq', keyValue: `={{ ${WH}.From }}` }],
      },
      returnAll: true,
      orderBy: true,
      orderByColumn: 'id',
      orderByDirection: 'ASC',
    },
    ...retry,
  },
  codeNode('Debounce & Combine', [1320, 300], 'scripts/debounce_combine.js'),
  {
    id: uid('table'),
    name: 'Clear Consumed Buffer',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [1540, 100],
    parameters: {
      resource: 'row',
      operation: 'deleteRows',
      dataTableId: { __rl: true, mode: 'name', value: BUFFER_TABLE },
      matchType: 'allConditions',
      filters: {
        conditions: [
          { keyName: 'phone', condition: 'eq', keyValue: '={{ $json.phoneNumber }}' },
          { keyName: 'id', condition: 'lte', keyValue: '={{ $json.maxBufferRowId }}' },
        ],
      },
      options: {},
    },
    ...retry,
  },
  ghlRequest({
    name: 'GHL Upsert Contact',
    position: [1540, 300],
    method: 'POST',
    url: `${GHL_BASE}/contacts/upsert`,
    apiVersion: CONTACTS_API_VERSION,
    jsonBody: `={{ JSON.stringify({ locationId: ${CFG}.ghlLocationId, phone: $json.phoneNumber, source: 'Eric SMS (Twilio)' }) }}`,
  }),
  ghlRequest({
    name: 'GHL Log Inbound Message',
    position: [1760, 300],
    method: 'POST',
    url: `${GHL_BASE}/conversations/messages/inbound`,
    apiVersion: CONVERSATIONS_API_VERSION,
    jsonBody:
      "={{ JSON.stringify({ type: 'SMS', direction: 'inbound', contactId: $json.contact.id, " +
      `conversationProviderId: ${CFG}.ghlConversationProviderId, ` +
      "message: $('Debounce & Combine').first().json.combinedMessage, " +
      "altId: $('Debounce & Combine').first().json.lastMessageSid, " +
      "date: $('Debounce & Combine').first().json.timestamp, attachments: [] }) }}",
  }),
  ghlRequest({
    name: 'GHL Get Conversation History',
    position: [1980, 300],
    method: 'GET',
    url: `=${GHL_BASE}/conversations/{{ $json.conversationId }}/messages`,
    apiVersion: CONVERSATIONS_API_VERSION,
    query: [{ name: 'limit', value: `={{ ${CFG}.historyLimit + 5 }}` }],
  }),
  codeNode('Build Eric Context', [2200, 300], 'scripts/build_eric_context.js'),
  {
    id: uid('llm'),
    name: 'Eric (Claude)',
    type: '@n8n/n8n-nodes-langchain.anthropic',
    typeVersion: 1,
    position: [2420, 300],
    parameters: {
      resource: 'text',
      operation: 'message',
      modelId: { __rl: true, mode: 'id', value: ANTHROPIC_MODEL },
      messages: { values: [{ role: 'user', content: '={{ $json.userPrompt }}' }] },
      simplify: true,
      options: {
        system: systemPrompt,
        includeMergedResponse: true,
        maxTokens: 300,
        temperature: 0.6,
      },
    },
    ...retry,
  },
  codeNode('Parse Eric Reply', [2640, 300], 'scripts/parse_eric_reply.js'),

  // ---- handoff branch ----
  booleanIf({ name: 'Handoff?', position: [2860, 160], leftValue: '={{ $json.handoff }}' }),
  ghlRequest({
    name: 'GHL Tag for Manual Review',
    position: [3080, 140],
    method: 'POST',
    url: `=${GHL_BASE}/contacts/{{ $json.contactId }}/tags`,
    apiVersion: CONTACTS_API_VERSION,
    jsonBody: '={{ JSON.stringify({ tags: $json.handoffTags }) }}',
  }),
  booleanIf({
    name: 'Opt-Out?',
    position: [3300, 140],
    leftValue: "={{ $('Parse Eric Reply').item.json.optOut }}",
  }),
  ghlRequest({
    name: 'GHL Set SMS DND',
    position: [3520, 120],
    method: 'PUT',
    url: `=${GHL_BASE}/contacts/{{ $('Parse Eric Reply').item.json.contactId }}`,
    apiVersion: CONTACTS_API_VERSION,
    jsonBody:
      "={{ JSON.stringify({ dndSettings: { sms: { status: 'active', message: 'Opted out via SMS keyword' } } }) }}",
  }),

  // ---- reply branch ----
  booleanIf({ name: 'Send Reply?', position: [2860, 460], leftValue: '={{ $json.sendReply }}' }),
  {
    id: uid('twilio'),
    name: 'Twilio Send Reply',
    type: 'n8n-nodes-base.twilio',
    typeVersion: 1,
    position: [3080, 440],
    parameters: {
      resource: 'sms',
      operation: 'send',
      from: '={{ $json.twilioNumber }}',
      to: '={{ $json.phoneNumber }}',
      toWhatsapp: false,
      message: '={{ $json.ericReplyText }}',
      options: {},
    },
    ...retry,
  },
  ghlRequest({
    name: 'GHL Log Outbound Reply',
    position: [3300, 440],
    method: 'POST',
    url: `${GHL_BASE}/conversations/messages/inbound`,
    apiVersion: CONVERSATIONS_API_VERSION,
    jsonBody: read('payloads/ghl_log_outbound_body.n8n.txt').trim(),
  }),
];

// ------------------------------------------------------------ connections --
const link = (...targets) => ({ main: targets.map((t) => (Array.isArray(t) ? t : [t]).map((node) => ({ node, type: 'main', index: 0 }))) });

const connections = {
  'Twilio Inbound Webhook': link('Ack Twilio (Empty TwiML)'),
  'Ack Twilio (Empty TwiML)': link('Eric Config'),
  'Eric Config': link('Buffer Inbound SMS'),
  'Buffer Inbound SMS': link('Wait 15s (Rapid-Fire Window)'),
  'Wait 15s (Rapid-Fire Window)': link('Get Buffered Messages'),
  'Get Buffered Messages': link('Debounce & Combine'),
  'Debounce & Combine': link(['Clear Consumed Buffer', 'GHL Upsert Contact']),
  'GHL Upsert Contact': link('GHL Log Inbound Message'),
  'GHL Log Inbound Message': link('GHL Get Conversation History'),
  'GHL Get Conversation History': link('Build Eric Context'),
  'Build Eric Context': link('Eric (Claude)'),
  'Eric (Claude)': link('Parse Eric Reply'),
  'Parse Eric Reply': link(['Handoff?', 'Send Reply?']),
  'Handoff?': link('GHL Tag for Manual Review', []),
  'GHL Tag for Manual Review': link('Opt-Out?'),
  'Opt-Out?': link('GHL Set SMS DND', []),
  'Send Reply?': link('Twilio Send Reply', []),
  'Twilio Send Reply': link('GHL Log Outbound Reply'),
};

const workflow = {
  name: 'Eric - Twilio Inbound SMS (15s Buffer -> Claude -> GHL)',
  nodes,
  connections,
  settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
  pinData: {},
};

const out = path.join(ROOT, 'workflows/eric_twilio_sms_workflow.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, out)} (${nodes.length} nodes)`);
