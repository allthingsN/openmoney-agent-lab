---
name: savings-memo
description: Format for a household savings memo with plan recommendations and a machine-readable summary. Use when writing the final recommendation for bills, plans or subscriptions.
---

# Savings memo

Write the memo to `outbox/savings-memo.md` with exactly these sections, in this order:

1. `# Savings memo` then one sentence: the total 24-month savings.
2. `## Internet` — the recommended offer (provider, plan, offer id), why it is eligible, its 12- and 24-month
   cost, and the runner-up. Mention offers you rejected and the rule each one failed (cap, typical speed,
   contract, availability...).
3. `## Phones` — same for mobile.
4. `## Cost comparison` — a Markdown table: rows Internet, Phones, Total; columns Current 24-mo, New 24-mo,
   Savings 24-mo.
5. `## Next steps` — at most 5 bullets the person can act on (order the switch, cancel the old service after the
   new one is active, return rented equipment...).
6. `## Summary JSON` — a fenced ```json block, the **last** thing in the file:

```json
{
  "internet": {"offer_id": "...", "cost_12mo": 0.00, "cost_24mo": 0.00},
  "mobile":   {"offer_id": "...", "cost_12mo": 0.00, "cost_24mo": 0.00},
  "current":  {"internet_24mo": 0.00, "mobile_24mo": 0.00},
  "savings_24mo": 0.00,
  "savings_first_year": 0.00
}
```

`savings_first_year` = (current internet + current mobile over 12 months) − (new internet + new mobile cost_12mo).
Numbers are plain decimals (no `$`, no thousands separators). Label sponsored offers "Sponsored" in the prose.
