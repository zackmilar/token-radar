[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/zackmilar/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/zackmilar/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).
It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that
record no token yet, ranks them by what a launch would be worth, and hands
each one a concrete six-step farm plan with costs and times.

## The board

178 rows: the whole 40-protocol watchlist plus 138 early finds below the
$50M floor that pass the watchlist rule re-applied strictly. Bridges,
liquid-staking products and other wrapped or staked products of tokens that
already trade are left out — a bridge's token already trades, so ranking it
as pre-token would mix a launch that already happened into this board. Four
early rows break into the top 40: Aegis YUSD (#27), Manta CeDeFi (#29),
Liminal Basis (#32) and Drakewell (#35).

## The value model

```
implied value = TVL × ratio × growth × maturity
```

- **Ratio:** the median market-cap / TVL of the priced peers in the same
  category, when the category has at least 3 of them; otherwise the median
  over all 128 priced protocols (0.2138, computed from the snapshot at run
  time, never hardcoded).
- **Growth:** the 7-day TVL change, clamped to −60% … +120% and counted at
  half weight.
- **Growth shown:** the per-row growth figure is the clamped change, rounded
  to two decimals — a +4,448% week reads as +120.
- **Maturity:** 0.6 plus up to 0.4 spread over 1,095 days with no token;
  a missing listing date counts as one year.

No protocol name is special-cased: one function scores every row. The top
row is steakhouse-financial at $464,924,662. The dashboard states the ratio
source on every row, including the 25 of 40 watchlist rows that fall back
to the global median because their category has fewer than 3 priced peers.

## Running it

Node 22 or later, standard library only — nothing to install.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. The run is deterministic:
run it twice and the outputs are byte-identical. The dashboard is a static
page that renders with no network; open `out/dashboard/index.html` in a
browser.

## Layout

- `main.ts` — the program: reads the snapshot, writes the outputs.
- `lib/model.ts` — the radar-2 model, the strict coverage rule, the farm
  plans, and the board's own gate check.
- `vendor/makefun-board.ts` — the kit's dossier library, byte-for-byte.
- `dashboard/` — the page: board, detail view per protocol, filters,
  sortable columns, the model panel with the comparables table.
- `screenshots/` — board, protocol detail, and filtered views.
- `LICENSE` — MIT.

## Standing

The board is this entry's own claim, built from the snapshot's figures
alone. It does not predict whether or when any protocol issues a token,
and a protocol "records no token" in the snapshot — that is the record,
not proof it has none.
