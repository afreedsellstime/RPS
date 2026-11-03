# Opener v4: draft for review (nothing is live yet)

## The new texts

Examples use Maria and 12834 Rockwell Ct. GHL adds "Reply STOP to opt out" at the end.

| Lead type | Current (v3) | Proposed (v4) |
|---|---|---|
| Default A (NOD, NTS, pre-foreclosure, divorce, bankruptcy, motivated, other) | Hi Maria this is Eric with RPS. I came across 12834 Rockwell Ct while going through the area. Would you ever think about selling it? | Hi Maria this is Eric with RPS. Would you consider selling 12834 Rockwell Ct at some point? If not, just say no and I won't text again. |
| Default B (same lists, alternate contacts) | (same as above) | Hi Maria this is Eric with RPS in San Diego. Are you still the owner of 12834 Rockwell Ct? If not, no worries. |
| Expired listing | Hi Maria this is Eric with RPS. I noticed 12834 Rockwell Ct came off the market. Still thinking about selling at some point? | Hi Maria this is Eric with RPS. I saw 12834 Rockwell Ct came off the market. Still hoping to sell, or keeping it for now? |
| FSBO | Hi Maria this is Eric with RPS. Saw 12834 Rockwell Ct is listed by owner. Is it still available? | Hi Maria this is Eric with RPS. Saw 12834 Rockwell Ct is listed by owner. Is it still available or already sold? |
| Affidavit of death (no name) | Hi this is Eric with RPS. I'm trying to reach the right person about the property at 12834 Rockwell Ct. Would that be you? | Hi this is Eric with RPS. Trying to reach whoever handles the property at 12834 Rockwell Ct. Is that you? If not, sorry to bother you. |
| Follow-up (one only, 4+ days after the opener, no reply) | none written down | Hi Maria Eric with RPS again about 12834 Rockwell Ct. If selling isn't on your mind, just say no and I'll close my file. |

## Why these should get fewer STOPs

1. **Give people an easy no.** Most STOPs come from people who simply aren't interested and see STOP as the only polite exit. "Just say no and I won't text again" gives them another one. A "no" isn't counted as an opt-out by GoHighLevel. Your safety check already turns DND on for a no, so they're never texted again either way. This is the biggest lever on the 7-day opt-out rate.
2. **Drop the pretext.** "While going through the area" reads as a template to anyone who doesn't live there (absentee owners, condos, inherited homes), and it's the kind of line people report as spam.
3. **Either-or questions** ("still hoping to sell, or keeping it?", "still available or already sold?") make it easy to reply with a word instead of ignoring or blocking.
4. **No mention of the reason they're on a list.** Nothing about default, trustee sale, divorce, bankruptcy or a death. That feels invasive to the reader, and in California texts that reference foreclosure while offering help can fall under the foreclosure consultant rules (Civil Code 2945).
5. **One text, not two.** Each text fits in a single SMS for typical names and streets. Long ones (11-letter names plus long streets) run to two, as today.

All six texts pass the team's rules (checked by `check_openers.py`):
- They start with "Hi", with no comma after "Hi" or the name.
- None of these: offer, cash, buy, as is, homeowners, links, `$`, `!`, dashes or curly quotes.
- No KW, no "Rayle", and no "Property Solutions" spelled out.
- No mention of foreclosure, divorce, bankruptcy or death.

## A/B test for the default lists

The sender alternates A and B within each batch. Tags show which text each person got:
- `opener-v4a` for A and `opener-v4b` for B
- `opener-v4` for the other lead types
- `followup-v4` for the follow-up

Compare the two after **about 150 sends each**: STOP rate, plus the share of replies showing interest. Wednesday's 75 openers will give an early read, not a verdict.

## What changes when you approve

### 1. Sender task "SMS outbound sender (hourly, autonomous)", Step 3 and Step 4

- Replace the four opener lines in Step 3 with the v4 texts above.
- Add: "For the default lead types, alternate: 1st, 3rd, 5th... contact in the batch gets text A, 2nd, 4th, 6th... gets text B."
- In Step 4, the tag `opener-v3` becomes the variant tag (`opener-v4a`, `opener-v4b` or `opener-v4`). The `opener-sent-<date>` tag stays.
- Nothing else changes: health checks, pause rules, batch sizes and the daily cap stay as they are.

### 2. Eric's prompt: Tone Patch v12 in Chatbot Inbound and Chatbot Outbound

This edits the latest patch node only, per the team's rule. It changes one string: the "current openers" section. The old v3 openers **stay in the list**, because the 423 people who got them can still reply. The new section adds:

> The newer openers are: "Would you consider selling [street] at some point? If not, just say no and I won't text again." (default A), "Are you still the owner of [street]? If not, no worries." (default B, ownership check), "I saw [street] came off the market. Still hoping to sell, or keeping it for now?" (expired), "Saw [street] is listed by owner. Is it still available or already sold?" (for sale by owner), "Trying to reach whoever handles the property at [street]. Is that you? If not, sorry to bother you." (affidavit of death), and the one follow up "If selling isn't on your mind, just say no and I'll close my file." The same rules apply to them as to the openers above, with these additions. For the ownership check, a yes only confirms they own it and is not interest yet: acknowledge it in a few words and ask one easy question about whether they would ever consider selling it. A no, sold or not mine means wrong person: use the wrong number exit. For the expired opener, keeping it is a no. For the for sale by owner opener, still available means still for sale and counts as open to selling, and already sold is a no. For the affidavit opener the existing affidavit rules apply.

After the edit, I rebuild the effective prompt and confirm the v12 stamp and the new section are present. I won't press Execute.

### 3. Follow-up text

The follow-up isn't in any automated task yet; it goes wherever the team sends follow-ups from. I can add it as an optional step in the sender task, or give it to whoever runs the Wednesday follow-ups.

## Timing

If approved before Wednesday 2pm Pacific, the 75 openers and the roughly 15 follow-ups go out with v4.
