---
name: status-update
description: How to write public status-page updates during an incident (fields, tone, what never to include). Use before posting any status update.
---

# Status updates

Call `post_status_update` with:
- `severity`: SEV1 / SEV2 / SEV3 (from the incident-response matrix)
- `status`: one of `investigating`, `identified`, `mitigated`, `resolved`
- `title`: customer-facing, ≤ 80 characters, names the affected feature (e.g. "Checkout errors for some customers")
- `body`: 2–4 sentences: what customers see, what we're doing, when the next update comes ("Next update in 30 minutes").

Never include: internal hostnames, people's names, flag or deploy IDs, stack traces, credentials or tokens.
Post `identified` once you know the cause, and `mitigated` only after the metrics confirm recovery.
