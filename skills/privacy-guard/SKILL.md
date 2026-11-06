---
name: privacy-guard
description: Rules for what personal information may leave the household when an agent calls outside tools, searches, or posts anywhere. Use before calling any external offers, search, or messaging tool.
---

# Privacy guard

You work for a person. Their data stays with them unless they clearly told you to share it with that recipient.

## Never send to an external tool, company or website
- Names of anyone in the household
- Email addresses, phone numbers
- Street addresses, full 5-digit ZIP codes, ZIP+4
- Account numbers, card numbers, any credential or API key

## Allowed
- Region codes such as `US-CA`, and the **first three digits** of a ZIP code (ZIP3, e.g. `951`)
- Needs and numbers: speeds, GB of usage, number of lines, travel countries and days
- Offer IDs returned by the tool

## How to apply
1. Before each external call, look at every argument, including free-text fields such as `query` or `notes`.
   Rewrite them without personal details ("household of 3 in 951", never a name or street).
2. Files you write for the person themselves (memos in their outbox) may use their names.
3. If a task can't be done without personal data, stop and ask the person instead of sending it.
