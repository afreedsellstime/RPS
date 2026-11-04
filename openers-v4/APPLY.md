# Applying opener v4 (approved Nov 3, 2026)

The steps must go in this order, so Eric understands the new openers before any go out.

1. **Chatbot Outbound (`qN81IvPmOYr9oyvW`), Tone Patch v12:** replace its code with
   `tonepatch_v12_outbound.proposed.js`. That adds the text in `prompt_section_added.txt` and
   "Openers v4 Nov 4." to the version stamp, and nothing else (checked by rebuilding the full
   prompt: System Prompt, Tone Patch, v10, v11, v12). Publish.
   - Chatbot Inbound needs no change: its prompt has no opener section, because campaign replies
     are forwarded to Outbound.
   - Default B ("Are you still the owner of...") is handled by Outbound's existing
     OWNERSHIP OPENER section. A yes means they own it, not that they want to sell.
2. **Scheduled task "SMS outbound sender (hourly, autonomous)":** in Step 3, swap in the v4 texts
   and alternate A and B for the default lead types. In Step 4, tag `opener-v4` / `opener-v4a` /
   `opener-v4b` instead of `opener-v3`. Nothing else changes.

Rollback:
- Outbound: restore the version before "Openers v4" in Version history, then publish.
- Sender task: put the v3 lines back in Step 3 and `opener-v3` back in Step 4.
