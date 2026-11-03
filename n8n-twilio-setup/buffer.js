// This node expects an array of incoming Twilio webhook items
// It groups them by phone number ('From') and concatenates the text ('Body')

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 1. Wait for 15 seconds to allow rapid-fire texts to accumulate
await delay(15000);

// 2. Fetch all executions or items currently backed up in this execution context
// Note: In a high-volume n8n production webhook layout, ensure your execution
// settings allow batching or use a centralized state/cache if using multiple instances.
const items = $input.all();
const groupedMessages = {};

for (const item of items) {
    const fromNumber = item.json.body.From;
    const messageBody = item.json.body.Body ? item.json.body.Body.trim() : '';

    if (!fromNumber) continue;

    if (!groupedMessages[fromNumber]) {
        groupedMessages[fromNumber] = {
            from: fromNumber,
            messages: [],
            rawPayload: item.json.body
        };
    }
    if (messageBody) {
        groupedMessages[fromNumber].messages.push(messageBody);
    }
}

// 3. Construct the clean, unified payload for Claude (Eric)
const output = [];
for (const fromNumber in groupedMessages) {
    const profile = groupedMessages[fromNumber];
    output.push({
        json: {
            phoneNumber: profile.from,
            combinedMessage: profile.messages.join(" \n "),
            originalTwilioData: profile.rawPayload,
            timestamp: new Date().toISOString()
        }
    });
}

return output;
