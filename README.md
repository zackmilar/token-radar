# Token Radar — make.fun token-radar-01 entry

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zackmilar/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zackmilar/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: the sealed DefiLlama snapshot's 40-protocol watchlist, ranked by implied
value, plus every below-floor pre-token protocol that passes the watchlist rule strictly —
178 rows. Original code, MIT licensed.

## How it works

- **Value model (radar-2):** `implied = TVL × ratio × growth × maturity`. Ratio is the median
  mcap/TVL of positive-mcap peers in the same category (at least 3 priced peers, else the global
  median 0.2138, computed from the snapshot at run time — never hardcoded). Growth is the
  seven-day move clamped to [−60, +120] at weight 0.5. Maturity is 0.6–1.0 over 1,095 days
  with no token. No protocol name is special-cased.
- **Top of the board:** steakhouse-financial $464,924,662; gauntlet $276,897,852;
  veda $266,216,989. Four below-floor early rows outrank the watchlist tail.
- **Farm plans:** six steps per protocol, derived from its own category, chains, TVL and age,
  with capital, cost and time on every step.
- **Program:** `main.ts` (Node 22, standard library only) reads the sealed snapshot, writes
  `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json`
  with the vendored make.fun library. Runs twice, byte-identical.

## Results (measured locally, kit harness)

- 178 rows = 40 watchlist + 138 early; watchlist coverage 40/40; ranks 1..178; implied values
  strictly non-rising and all distinct.
- Determinism: two runs byte-identical (board.json + dossier.json sha256 match).
- Dossier under the 1.5 MiB cap; dashboard source 34,298 B, under the 65,536 B text cap;
  screenshots 1440×900, each under 512 KiB. Exact figures in TEST-REPORT.md.

Entry built for [make.fun/bounty/token-radar-01](https://make.fun/bounty/token-radar-01).
