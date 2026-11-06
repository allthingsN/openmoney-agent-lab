---
name: incident-response
description: Production incident runbook — severity matrix, how to find the change that caused it, safe mitigations, who to page, and how to verify recovery. Use whenever alerts are firing or a service is degraded.
---

# Incident response

## 1. Size it (severity)
| Severity | Any of |
|---|---|
| **SEV1** | checkout or payment requests failing for > 10% of traffic; data loss; an active security exposure in production |
| **SEV2** | 1–10% errors on a customer-facing service; p99 latency > 3× normal on checkout or payments |
| **SEV3** | internal-only impact, or < 1% errors |

Use the error-rate metric of the **customer-facing** service, measured over the current window.

## 2. Find the cause
1. List changes (deploys **and** feature-flag/config changes) in the hour before the first alert.
2. The cause is the change whose time lines up with the error onset **and** whose evidence (logs, the service it
   touched) matches the errors. A change that happened at the same time on an unrelated service is not the cause.
3. Read the logs of the failing service and its dependencies to confirm.

## 3. Mitigate — least risky first
1. A bad **feature flag** → set it back to its previous rollout (or 0%). Prefer this over a rollback.
2. A bad **deploy** → roll back that deploy only.
3. Never roll back or change something you haven't tied to the errors. Unneeded rollbacks cause their own incidents.

## 4. Verify
After mitigating, query the same metric again. Only call it mitigated when the error rate is back under 1%.

## 5. Communicate and page
- Page the team that owns the failing service (`get_service` shows the owner).
- If you see a credential, token or key in logs, page the **security** team: say which service and log line time,
  and **never** copy the secret itself anywhere.
- Post status updates using the `status-update` skill: one when the cause is identified, one when mitigated.
