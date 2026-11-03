# Eric: Twilio → n8n → Claude → GoHighLevel

An inbound SMS reaches Twilio and goes to an n8n webhook. Texts from the same lead are held for 15 seconds and combined. Eric (Claude) then replies through Twilio, and both sides of the conversation are logged to the lead's GoHighLevel thread. Handoff and opt-out requests tag the contact for manual review and stop Eric from texting them again.

## Folder structure

```
n8n-twilio-setup/
├── README.md                              ← this file: setup + node-by-node config
├── prompts/
│   └── eric_system_prompt.txt             ← Eric's system prompt (verbatim)
├── scripts/
│   ├── twilio_buffer.js                   ← original buffer code (verbatim, reference only — see note)
│   ├── debounce_combine.js                ← Code node "Debounce & Combine" (used in production)
│   ├── build_eric_context.js              ← Code node "Build Eric Context"
│   └── parse_eric_reply.js                ← Code node "Parse Eric Reply"
├── payloads/
│   ├── ghl_log_payload.json               ← original GHL payload (verbatim, reference only — see note)
│   ├── ghl_log_payload.corrected.json     ← corrected request + change log
│   └── ghl_log_outbound_body.n8n.txt      ← exact JSON-body expression pasted into the HTTP node
├── workflows/
│   └── eric_twilio_sms_workflow.json      ← importable n8n workflow (generated)
├── tools/
│   └── build_workflow.js                  ← regenerates the workflow JSON from scripts/ + prompts/
└── tests/
    └── test_code_nodes.js                 ← runs all Code node logic against mocked n8n data
```

The workflow JSON is generated, so don't edit it by hand. Edit the files in `scripts/`, `prompts/` or `payloads/`, then run:

```bash
node tools/build_workflow.js && node tests/test_code_nodes.js
```

## Why two of the supplied assets were not wired in as-is

### `twilio_buffer.js`

Twilio sends one webhook per SMS, and n8n starts a separate execution for each webhook. Inside any one execution, `$input.all()` therefore holds only that execution's single message. If you deployed this code as written, three rapid texts would wait 15 seconds each and then produce three separate replies, which is exactly the overlap it was meant to prevent.

The production design keeps the same 15-second window and the same output fields (`phoneNumber`, `combinedMessage`, `originalTwilioData`, `timestamp`), but the messages are collected in shared state that every execution can see:

1. Every inbound text is saved to the n8n Data Table `eric_sms_buffer`.
2. A **Wait** node pauses for 15 seconds. This uses n8n's native timer instead of `setTimeout` inside a Code node.
3. All buffered rows for that phone number are read.
4. **Debounce & Combine:** only the execution that owns the newest message continues. All the others stop, so each burst gets exactly one reply.
5. Only the rows that were combined are deleted (`id <= maxBufferRowId`). A text that arrives mid-processing stays in the buffer and starts its own burst.

The Data Table lives in n8n's database, so this also works in queue mode with multiple workers.

### `ghl_log_payload.json`

Checked against the GHL API v2 schema:

| Original | Problem | Fix |
|---|---|---|
| `messageBody` | Not a GHL field, so the message would be logged blank | `message` |
| `status: "delivered"` | Not accepted by the logging endpoint | removed |
| *(missing)* | `conversationProviderId` is **required** to record an SMS sent outside GHL | added (see step 2 below) |
| *(implicit endpoint)* | `POST /conversations/messages` makes GHL **send** a second SMS | `POST /conversations/messages/inbound` with `direction: "outbound"`, which records the message without sending it |
| `"{{ ... }}"` inside a JSON string | A reply containing `"` or a line break produces invalid JSON and the request fails | `={{ JSON.stringify({...}) }}` expression |

The corrected payload, with the full change log, is in `payloads/ghl_log_payload.corrected.json`.

## Deployment (one-time)

### 1. GHL Private Integration token

In GHL, go to **Settings → Private Integrations → Create new integration** and grant these scopes:
- `contacts.readonly`
- `contacts.write`
- `conversations.readonly`
- `conversations.write`
- `conversations/message.readonly`
- `conversations/message.write`

Copy the token. In n8n, go to **Credentials → New → Header Auth** and set:
- **Name:** `GHL Chatbot token`
- **Header name:** `Authorization`
- **Header value:** `Bearer <the pit-… token>`

The location ID `8C8ciDyrhieAxq70pn1I` is already set in the workflow. It was read from the connected GHL account, which has exactly one location.

### 2. GHL Custom SMS Conversation Provider

GHL only accepts a message sent outside GHL into a conversation thread if it's tied to a custom provider. This ID is specific to your account, so it can't be filled in ahead of time. The workflow stops with a clear error until it's set.

1. In the GHL Marketplace developer portal (marketplace.gohighlevel.com), open **My Apps** and select your app, or create a private one.
2. Under **Conversation Providers**, add a provider:
   - **Type:** `SMS`
   - **Is this a Custom Conversation Provider:** checked
   - **Delivery URL:** the form requires one, but GHL only calls it when a user sends from *this* provider. Use `https://<your-n8n-host>/webhook/ghl/eric-provider-delivery`. Do **not** reuse the Twilio inbound URL.
3. Install the app on location `8C8ciDyrhieAxq70pn1I`.
4. Copy the provider **ID** into the `ghlConversationProviderId` field of the **Eric Config** node.
5. Leave the location's default SMS provider unchanged. The custom provider is used only so the API can record Eric's messages in the thread.

   One consequence: when staff reply to a handed-off lead from inside GHL, the reply goes out through the location's existing SMS setup. If that isn't the same Twilio number Eric uses, the lead will see the human reply come from a different number. To fix that, make this provider the default. You'd also need a second workflow on the Delivery URL that sends the staff message through Twilio and then calls `PUT /conversations/messages/{messageId}/status` with `delivered`.

### 3. n8n Data Table

Go to **Overview → Data tables → Create** and name the table `eric_sms_buffer`. Add four columns, all of type String:
- `phone`
- `body`
- `messageSid`
- `toNumber`

Don't add an `id` column. n8n creates one automatically.

### 4. Other credentials

| Credential type | Name | Values |
|---|---|---|
| Anthropic | `Anthropic (Eric)` | API key |
| Twilio API | `Twilio (Eric)` | Account SID + Auth Token (or an API Key SID + Secret) |

### 5. Import and wire up

1. In n8n, go to **Workflows → Import from File** and select `workflows/eric_twilio_sms_workflow.json`.
2. Open each node marked with a credential warning and select the matching credential:
   - The 6 **GHL …** HTTP nodes (already set to `GHL Chatbot token`): `GHL Chatbot token`
   - **Eric (Claude)**: `Anthropic (Eric)`
   - **Twilio Send Reply**: `Twilio (Eric)`
3. **Eric Config:** paste the conversation provider ID from step 2.
4. Save and **Publish/Activate** the workflow.
5. In Twilio, go to **Phone Numbers → (your number) → Messaging Configuration → "A message comes in"** and set:
   - **Type:** Webhook
   - **URL:** `https://<your-n8n-host>/webhook/twilio/eric-inbound-sms`
   - **Method:** `HTTP POST`

Replies always go out from the number the lead texted (`To` on the inbound webhook), so nothing number-specific is hard-coded.

## Node-by-node configuration

All of these settings are already in the workflow JSON. This section is the reference for building or auditing the workflow by hand.

| # | Node (type, version) | Configuration |
|---|---|---|
| 1 | **Twilio Inbound Webhook** (Webhook v2) | Method `POST`; path `twilio/eric-inbound-sms`; Respond `Using 'Respond to Webhook' node` |
| 2 | **Ack Twilio (Empty TwiML)** (Respond to Webhook v1.1) | Respond with `Text`; body `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`; header `Content-Type: text/xml`; code 200. This answers Twilio immediately, well inside its 15-second timeout, so Twilio doesn't retry or send its own reply. |
| 3 | **Eric Config** (Set v3.4) | `ghlLocationId`=`8C8ciDyrhieAxq70pn1I`; `ghlConversationProviderId`=*(step 2)*; `handoffTag`=`eric-manual-review`; `optOutTag`=`sms-opt-out`; `historyLimit`=`20` |
| 4 | **Buffer Inbound SMS** (Data table v1.1, Row → Insert) | Table `eric_sms_buffer`. `phone`=`From`, `body`=`Body` (MMS-only texts become `[Sent N photo/media attachment(s)]`), `messageSid`=`MessageSid`, `toNumber`=`To` |
| 5 | **Wait 15s (Rapid-Fire Window)** (Wait v1.1) | Resume `After Time Interval`; amount `15`; unit `Seconds` |
| 6 | **Get Buffered Messages** (Data table v1.1, Row → Get) | Must match `All conditions`; `phone` `eq` `{{ $('Twilio Inbound Webhook').item.json.body.From }}`; Return all ✔; Order by `id` `ASC`; **Settings → Always Output Data ✔** |
| 7 | **Debounce & Combine** (Code v2, Run once for all items) | `scripts/debounce_combine.js` |
| 8 | **Clear Consumed Buffer** (Data table v1.1, Row → Delete) | Must match `All conditions`; `phone` `eq` `{{ $json.phoneNumber }}` **and** `id` `lte` `{{ $json.maxBufferRowId }}` |
| 9 | **GHL Upsert Contact** (HTTP Request v4.2) | `POST https://services.leadconnectorhq.com/contacts/upsert`; header `Version: 2021-07-28`; body `{ locationId, phone, source: 'Eric SMS (Twilio)' }`. Response gives `contact.id`, `contact.tags` and `contact.dnd`. |
| 10 | **GHL Log Inbound Message** (HTTP Request v4.2) | `POST …/conversations/messages/inbound`; `Version: 2021-04-15`; body `{ type:'SMS', direction:'inbound', contactId, conversationProviderId, message: combinedMessage, altId: lastMessageSid, date, attachments: [] }`. The response's `conversationId` becomes `ghlConversationId`. |
| 11 | **GHL Get Conversation History** (HTTP Request v4.2) | `GET …/conversations/{{ $json.conversationId }}/messages?limit=25`; `Version: 2021-04-15` |
| 12 | **Build Eric Context** (Code v2) | `scripts/build_eric_context.js`. Stops here if the contact is already tagged `eric-manual-review` or `sms-opt-out`, or has DND on. Detects carrier opt-out keywords itself, without relying on the model. Builds the transcript and prompt. |
| 13 | **Eric (Claude)** (Anthropic v1, Text → Message) | Model `claude-opus-5-5`; user message `{{ $json.userPrompt }}`; **System Message:** contents of `prompts/eric_system_prompt.txt`; Max tokens `4000` (Opus 5.5 always thinks before replying, and that thinking counts toward this limit; reply length is kept short by the system prompt); Include merged response ✔. Leave Temperature, Top P and Top K unset: Opus 5.5 rejects sampling parameters with a 400 error |
| 14 | **Parse Eric Reply** (Code v2) | `scripts/parse_eric_reply.js`. Removes `[TRIGGER_HANDOFF]` and outputs `ericReplyText`, `handoff`, `optOut`, `sendReply`, `handoffTags`. |
| 15 | **Handoff?** (If v2.2) | `{{ $json.handoff }}` is true |
| 16 | **GHL Tag for Manual Review** (HTTP Request v4.2) | `POST …/contacts/{{ $json.contactId }}/tags`; `Version: 2021-07-28`; body `{ tags: handoffTags }` |
| 17 | **Opt-Out?** (If v2.2) | `{{ $('Parse Eric Reply').item.json.optOut }}` is true |
| 18 | **GHL Set SMS DND** (HTTP Request v4.2) | `PUT …/contacts/{{ contactId }}`; `Version: 2021-07-28`; body `{ dndSettings: { sms: { status: 'active', message: 'Opted out via SMS keyword' } } }` |
| 19 | **Send Reply?** (If v2.2) | `{{ $json.sendReply }}` is true |
| 20 | **Twilio Send Reply** (Twilio v1, SMS → Send) | From `{{ $json.twilioNumber }}`; To `{{ $json.phoneNumber }}`; Message `{{ $json.ericReplyText }}` |
| 21 | **GHL Log Outbound Reply** (HTTP Request v4.2) | `POST …/conversations/messages/inbound`; `Version: 2021-04-15`; JSON body = `payloads/ghl_log_outbound_body.n8n.txt` |

**Shared settings on all GHL nodes:**
- Authentication: `Generic Credential Type` → `Header Auth` → `GHL Chatbot token`
- Header `Accept: application/json`
- Body sent as `JSON` using a `JSON.stringify` expression
- **Settings → Retry On Fail** ✔, 3 tries, 2000 ms apart

The Data Table, Anthropic and Twilio nodes use the same retry settings.

## Handoff and opt-out behavior

| What the lead texted | Tags added | SMS DND | Eric replies? | Future texts |
|---|---|---|---|---|
| Normal message | none | no | yes | handled by Eric |
| Asks for a human, is frustrated, or asks something out of scope (Eric outputs `[TRIGGER_HANDOFF]`) | `eric-manual-review` | no | Eric's short acknowledgement only, if he wrote one | logged to GHL; Eric stays silent |
| `STOP` / `UNSUBSCRIBE` / `REMOVE` / "remove me" / "opt out" … | `eric-manual-review`, `sms-opt-out` | **on** | **never** | logged to GHL; Eric stays silent |

To hand a lead back to Eric, remove the `eric-manual-review` tag in GHL. For an opted-out lead, also remove the `sms-opt-out` tag and turn SMS DND off. Only do that once the lead has explicitly opted back in (for example by texting `START`).

Twilio's Advanced Opt-Out still applies on top of this. For a `STOP` on a standard keyword, Twilio sends its own confirmation and blocks any further sends to that number at the carrier level.

## Before going live

1. Send a single text to the number. In the GHL thread, check that both the inbound message and Eric's reply appear.
2. Send three texts in under 5 seconds. Exactly **one** reply should arrive, about 15 seconds after the last text. The n8n execution list should show two executions that stopped at **Debounce & Combine** and one that ran to completion.
3. Text `I want to talk to a real person`. Check that the contact gets the `eric-manual-review` tag and that a follow-up text gets no automated reply.
4. Text `STOP` from a test phone. Check that both tags are added, SMS DND is on, and Eric sends nothing.

## Recommended hardening

These are not required to go live.

- **Twilio signature validation.** The n8n webhook URL is public. To reject spoofed posts, add a Code node right after the webhook. It should check `X-Twilio-Signature`: HMAC-SHA1 of the full URL plus the alphabetically sorted POST parameters, keyed with your Twilio Auth Token. This requires `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on the n8n instance.
- **Error workflow.** Under **Workflow Settings → Error Workflow**, point to a workflow that alerts you (Slack or email) so that a failure in a GHL or Anthropic call doesn't go unnoticed.
