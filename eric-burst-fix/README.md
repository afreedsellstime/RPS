# Eric burst fix (Nov 4, 2026)

Fixes the "rapid multi-text" silence: a seller sends 2-3 texts in a few seconds,
GHL skips the webhook for one of them, and every run assumes another run will reply.
This is what happened to Sergio Garcia on Oct 30: no reply to "$2,995,000" or his link.

## What changed (live in both Chatbot Inbound and Chatbot Outbound)

| Box | Change |
|---|---|
| **Claim Turn** (new, Inbound only) | Every incoming text writes a row to the n8n data table `eric_turn_claims` (contact, text, run id). It sits above Opt Out Check so it runs first. A STOP is claimed too, so no run ever answers past a STOP. |
| **Get Claims** (new) | Reads this seller's claims just before the messages are fetched. Placed before HTTP Request1, which is now set to "execute once". |
| **Debounce Check** | Still stops when a newer text **has its own run**. If a newer text has **no** run, it now waits until 20 seconds after this run started, checks again, and answers the whole burst if still nobody has it. GHL activity notes ("DnD enabled by customer") no longer count as texts. |
| **Wait 2s** | Wait time now comes from Debounce Check (2s for the normal re-fetch, up to ~20s for the burst wait). |
| **Get Claims (Pre-send)** (new) | Same lookup, just before Pre-send Check. |
| **Pre-send Check** | Same checks as before (team touched, reply already went out, duplicate text). New: if the seller texted again while Eric was thinking and that text has no run, it sends nothing *and* re-reads the conversation to answer everything (at most twice). Activity notes no longer cancel a reply. |
| **Reprocess?** (new) | On Safe to Send? = false with "re-read", loops back to Get Claims. |

Outbound does not write claims itself: every seller text enters through Inbound first.
Prompt nodes, the Claude call, pacing, tags, alerts and the send box were not touched.

## Tests

`node test_checks.js` replays Sergio's burst, Barbara's "No"/"Stop", single texts,
team takeover, duplicate guard, activity notes, and the "claims table down" case (18 cases).

## Rollback

Each workflow keeps its previous version in n8n's version history:

| Workflow | Before the fix (restore this) | With the fix |
|---|---|---|
| Chatbot Inbound `wknvWiG2Xr84HMRN` | `e3369d6c-c2d6-4fc9-8e74-b78c6ce131f2` | `5de6ee37-a941-4bd6-8a76-b115a9fa6b29` |
| Chatbot Outbound `qN81IvPmOYr9oyvW` | `abca2470-d52a-4bf1-9f6d-7dfdc9f23d73` | `e4c3cef7-0eb8-4480-9f38-05f7ae876020` |

In n8n: open the workflow, open **Version history**, pick the "before" version, restore, then publish.

## Housekeeping

`eric_turn_claims` gets one small row per inbound text. Clearing rows older than a
week is safe at any time (only the last few minutes matter).
