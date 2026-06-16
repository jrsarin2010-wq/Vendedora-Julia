---
name: Stats conversionRate format
description: The /api/stats endpoint returns conversionRate as a whole integer percentage, not a decimal fraction.
---

`GET /api/stats` returns `conversionRate` as a whole integer (e.g. `13` meaning 13%), calculated server-side as `Math.round((closed / total) * 100)`.

**Why:** Decided to keep the API human-readable to avoid frontend multiplication bugs.

**How to apply:** In the frontend, display as `${stats.conversionRate.toFixed(1)}%` — do NOT do `stats.conversionRate * 100`.
