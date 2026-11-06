---
name: true-cost
description: Compute the real cost of a home-internet or mobile plan over 12 and 24 months (promos, autopay, equipment, fees, taxes, roaming passes) and decide which offers are eligible. Use before comparing or recommending any plan.
---

# True cost of a plan

Headline prices lie. Always compute the cost the household will actually pay, and only compare eligible offers.

## 1. Eligibility (drop an offer if any rule fails)

**Home internet**
- `download_mbps_typical` must be ≥ the household's minimum download. Ignore `download_mbps_max` ("up to" speeds).
- `upload_mbps` must be ≥ the minimum upload.
- If `data_cap_gb` is set, it must be ≥ the household's **highest** monthly download in the usage history.
  (A cap of `null` means no cap.)
- `contract_months` must be 0 when the household says no contracts.
- The offer must be **available** where they live: call the availability tool. Never assume.

**Mobile**
- The plan must support the number of lines and keep their numbers (`keep_numbers`).
- Data: `data_gb_per_line: null` and `pool_gb: null` means unlimited. A per-line allowance must be ≥ each line's
  highest monthly data use. A shared `pool_gb` must be ≥ the highest **combined** monthly use of all lines.
- Hotspot: `hotspot_gb_per_line` must be ≥ the highest monthly hotspot use of every line that uses hotspot.
  `"uses plan data"` means hotspot comes out of the plan's data and needs no separate allowance.
- Roaming: if a line needs a country, the plan must include it **or** sell a day pass (`day_pass_per_day`).
  A plan with neither is ineligible.

## 2. Cost over N months (N = 12 and N = 24)

```
monthly base        = promo price for the promo months, regular price after
autopay discount    = subtract it every month if the household accepts autopay
                      (mobile: autopay_discount_per_line × lines)
equipment           = equipment_monthly every month
monthly fees        = sum of monthly_fees every month
taxes               = taxes_monthly (mobile: taxes_monthly_by_lines for the line count) every month
one-time fees       = added once (per_line fees × lines)
roaming passes      = day_pass_per_day × travel days per year × (N / 12), only when the country isn't included

cost(N) = Σ over months 1..N of (base − autopay + equipment + fees + taxes) + one-time fees + roaming passes
```

Work with cents and round only the final figure to 2 decimals. Use the calculator tool for arithmetic;
don't do sums in your head.

## 3. Ranking

Rank eligible offers by **24-month cost** (lowest first); break ties with 12-month cost. Sponsored placement and
headline prices never change the ranking. Say "Sponsored" next to any sponsored offer you mention.

## 4. Current cost

The household's current cost is its current monthly bill total × N (no promos left on it unless the bill says so).

See [reference/worked-example.md](reference/worked-example.md) for one plan computed end to end.
