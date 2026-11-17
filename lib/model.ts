// Token launch radar — value model "radar-2".
//
// Reads one sealed snapshot of DefiLlama protocol records and scores every
// protocol that records no token. The score is an implied launch value built
// only from the snapshot's own figures: size, the category's traded peers,
// the last seven days, and how long the protocol has run without a token.
//
//   implied = TVL x ratio x growth x maturity
//
// ratio    — median market-cap / TVL of the priced peers in the same
//            category, when that category has at least three of them;
//            otherwise the median over every priced protocol.
// growth   — the 7-day TVL move, clamped to [-60, +120] percent and
//            counted at half weight, so one noisy week cannot own a row.
// maturity — 0.6 plus up to 0.4 spread over 1,095 token-less days.
//            A missing listing date counts as one year.
//
// No protocol name is ever treated specially: one function scores all rows.
// The board carries the whole watchlist plus the below-floor protocols that
// pass the watchlist rule re-applied strictly. Bridges, liquid-staking
// products and the other wrapped or staked products of tokens that already
// trade are left out on purpose — ranking one as "pre-token" would mix a
// launch that already happened into a board of launches still to come.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotFile {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  ratio: number;
  ratio_source: "category" | "global";
  ratio_peers: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface DataRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  ratio: number;
  ratio_source: "category" | "global";
  ratio_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface RatioEntry {
  category: string;
  peers: number;
  median: number;
  used: boolean;
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    growth_weight: number;
    growth_floor: number;
    growth_cap: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    min_peers: number;
    global_ratio: number;
  };
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fallback_rows: number;
  fallback_watchlist: number;
  ratios: RatioEntry[];
  rows: DataRow[];
  live: LiveRow[];
}

export interface RadarResult {
  boardRows: BoardRow[];
  payload: RadarPayload;
  protocolCount: number;
  watchlistCount: number;
  earlyCount: number;
  liveCount: number;
}

// Tuning for the model. Every one of these is a plain number in the open;
// none of them names a protocol.
const PEER_FLOOR = 3;
const GROWTH_HALF = 0.5;
const GROWTH_LOW = -60;
const GROWTH_HIGH = 120;
const SEASON_FLOOR = 0.6;
const SEASON_SPAN = 0.4;
const SEASON_DAYS = 1095;
const AGE_FALLBACK = 365;
const LIVE_COUNT = 24;
const DAY_MS = 86_400_000;

// A name ending in a version marker, like "Pool V2" or "Swap 2.0".
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
// A whole word that marks a wrapped or staked product.
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

function round4dp(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round2dp(value: number): number {
  return Math.round(value * 100) / 100;
}

function medianOf(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[mid];
  }
  return (ordered[mid - 1] + ordered[mid]) / 2;
}

function clampPct(pct: number): number {
  if (pct < GROWTH_LOW) return GROWTH_LOW;
  if (pct > GROWTH_HIGH) return GROWTH_HIGH;
  return pct;
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(earlier + "T00:00:00Z");
  const end = Date.parse(later + "T00:00:00Z");
  return Math.floor((end - start) / DAY_MS);
}

function ageOrNull(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  return daysBetween(p.listed_at, asOf);
}

interface PeerTable {
  globalMedian: number;
  byCategory: Map<string, number[]>;
}

function buildPeerTable(protocols: SnapshotProtocol[]): PeerTable {
  const global: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    global.push(ratio);
    const key = p.category === null ? "" : p.category;
    const bucket = byCategory.get(key);
    if (bucket === undefined) {
      byCategory.set(key, [ratio]);
    } else {
      bucket.push(ratio);
    }
  }
  return { globalMedian: medianOf(global), byCategory };
}

function pickRatio(
  category: string | null,
  table: PeerTable,
): { ratio: number; source: "category" | "global"; peers: number } {
  const key = category === null ? "" : category;
  const bucket = table.byCategory.get(key);
  const count = bucket === undefined ? 0 : bucket.length;
  if (count >= PEER_FLOOR && bucket !== undefined) {
    return { ratio: medianOf(bucket), source: "category", peers: count };
  }
  return { ratio: table.globalMedian, source: "global", peers: count };
}

function scoreOne(
  p: SnapshotProtocol,
  table: PeerTable,
  asOf: string,
): { implied: number; breakdown: ModelBreakdown } {
  const picked = pickRatio(p.category, table);
  const age = ageOrNull(p, asOf);
  const ageForSeason = age === null ? AGE_FALLBACK : age;
  const weekly = p.change_7d === null ? 0 : p.change_7d;
  const growth = 1 + clampPct(weekly) / 100 * GROWTH_HALF;
  const maturity =
    SEASON_FLOOR + Math.min(ageForSeason, SEASON_DAYS) / SEASON_DAYS * SEASON_SPAN;
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * picked.ratio * growth * maturity),
  );
  return {
    implied,
    breakdown: {
      ratio: picked.ratio,
      ratio_source: picked.source,
      ratio_peers: picked.peers,
      // The row shows the clamped change, not the raw week: a +4,448% week reads as +120.
      growth_pct: round2dp(clampPct(weekly)),
      growth_multiplier: round4dp(growth),
      maturity_multiplier: round4dp(maturity),
      age_days: age,
    },
  };
}

function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function passesStrictRule(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// The first transaction's gas note. Only the home chain matters here:
// Ethereum costs real money, everywhere else the first move is cheap.
// Every later step quotes the same $1–3 estimate.
function firstGasNote(chain: string): string {
  if (chain === "Ethereum") return "about $5–15";
  return "under $3";
}

// The opening move of a farm plan: what the reader does with the protocol's
// main product, on its home chain, with the capital tier the TVL calls for.
function coreLine(
  category: string | null,
  name: string,
  chain: string,
  capital: number,
): string {
  const cost = ` Cost: $${capital} of capital and about $1–3 of gas. Time: 15 minutes to set up.`;
  switch (category) {
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the vault shares.` + cost;
    case "Lending":
    case "Uncollateralized Lending":
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` + cost;
    case "Dexs":
    case "Indexes":
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` + cost;
    case "RWA":
      return `Mint or buy $${capital} of the ${name} yield asset on ${chain} and hold it.` + cost;
    case "Yield":
    case "Yield Aggregator":
      return `Deposit $${capital} into the ${name} yield vault on ${chain} and keep the position open.` + cost;
    case "CDP":
      return `Mint $${capital} of the stable asset against collateral on ${name} on ${chain} and keep the position open.` + cost;
    case "Basis Trading":
      return `Deposit $${capital} margin and open one small hedged basis position on ${name} on ${chain}.` + cost;
    case "Derivatives":
    case "Interest Rate Derivatives":
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` + cost;
    case "Chain":
      return `Bridge $${capital} to ${chain} and use ${name}'s flagship app.` + cost;
    case "Restaking":
      return `Restake $${capital} of the liquid staking asset through ${name} and keep the receipt.` + cost;
    case "Staking Pool":
      return `Stake $${capital} through the ${name} pool on ${chain} and keep the receipt.` + cost;
    case "CeDeFi":
      return `Deposit $${capital} into the ${name} CeDeFi vault on ${chain} and keep the position open.` + cost;
    case "Payments":
      return `Fund $${capital} into the ${name} payment app on ${chain}.` + cost;
    case "Insurance":
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` + cost;
    case "Governance Incentives":
      return `Lock $${capital} for incentives on ${name} on ${chain}.` + cost;
    case "Stablecoin Wrapper":
      return `Mint or wrap $${capital} of the stable asset through ${name} on ${chain}.` + cost;
    case "Collateral Markets":
      return `Supply $${capital} of collateral to ${name} on ${chain} and keep the position open.` + cost;
    case "Liquidity Manager":
      return `Deposit $${capital} into the ${name} managed LP vault on ${chain} and keep the position open.` + cost;
    case "Leveraged Farming":
      return `Open a $${capital} leveraged position on ${name} on ${chain}.` + cost;
    case "Dual-Token Stablecoin":
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` + cost;
    default:
      return `Deposit $${capital} into ${name}'s main product on ${chain} and keep the position open.` + cost;
  }
}

// The weekly qualifying move. A row on three or more chains repeats the
// core action on a second chain; a row on one or two chains does a second
// thing inside the same app, named per category below.
function weeklyLine(
  category: string | null,
  name: string,
  chain: string,
  second: string | null,
  chainCount: number,
): string {
  const cost = ` Cost: about $1–3 of gas a week. Time: 10 minutes a week.`;
  if (second !== null) {
    return `Each week, repeat the core action on a second chain — ${second} — or add to another ${name} position, so the activity spans ${chainCount} chains.` + cost;
  }
  switch (category) {
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return `Each week, add to a second ${name} vault on ${chain}, or rebalance between the vaults you hold.` + cost;
    case "Lending":
      return `Each week, borrow a small amount against your ${name} supply and repay it, or supply a second asset on ${chain}.` + cost;
    case "Dexs":
      return `Each week, swap once through the ${name} pool, or add liquidity to a second pool on ${chain}.` + cost;
    case "RWA":
      return `Each week, trade a small amount of the ${name} asset on the secondary market, or stake the receipt where ${name} offers it.` + cost;
    case "Yield":
    case "Yield Aggregator":
      return `Each week, harvest and redeposit on ${name}, or move part of the deposit between strategies.` + cost;
    case "CDP":
      return `Each week, adjust the collateral ratio on ${name}, or mint a second tranche.` + cost;
    case "Basis Trading":
      return `Each week, roll or rebalance the hedge on ${name}.` + cost;
    case "Derivatives":
      return `Each week, close and reopen a small position on ${name}, or trade a second market.` + cost;
    case "Chain":
      return `Each week, use a second app on ${chain}, or add stake through ${name}.` + cost;
    case "Restaking":
      return `Each week, delegate to a second operator through ${name}.` + cost;
    case "Staking Pool":
      return `Each week, add stake through ${name}, or claim and restake the rewards.` + cost;
    case "CeDeFi":
      return `Each week, use the ${name} earn or card product once.` + cost;
    case "Payments":
      return `Each week, make one recurring payment through ${name}.` + cost;
    case "Insurance":
      return `Each week, check the cover on ${name} and extend or renew it if the term is short.` + cost;
    case "Governance Incentives":
      return `Each week, vote in one governance round on ${name}.` + cost;
    case "Stablecoin Wrapper":
      return `Each week, provide liquidity with the wrapped asset from ${name}.` + cost;
    case "Collateral Markets":
      return `Each week, borrow a small amount against your ${name} collateral and repay it.` + cost;
    case "Liquidity Manager":
      return `Each week, top up after a rebalance with ${name}.` + cost;
    case "Leveraged Farming":
      return `Each week, adjust the leverage ratio on ${name}.` + cost;
    default:
      return `Each week, repeat the core action on ${name}, or use a second product of the same protocol.` + cost;
  }
}

function planFor(
  p: SnapshotProtocol,
  age: number | null,
  capital: number,
): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const firstGas = firstGasNote(chain);
  const hold = holdFor(age);
  const second = p.chains.length >= 3 ? p.chains[1] : null;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: ${firstGas} of gas for the first transaction on ${chain}. Time: 5 minutes.`,
    coreLine(p.category, p.name, chain, capital),
    weeklyLine(p.category, p.name, chain, second, p.chains.length),
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

function liveTable(protocols: SnapshotProtocol[]): LiveRow[] {
  const priced = protocols.filter(
    (p) => p.mcap_usd !== null && p.category !== "CEX",
  );
  priced.sort((a, b) => {
    const diff = (b.mcap_usd as number) - (a.mcap_usd as number);
    if (diff !== 0) return diff;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return priced.slice(0, LIVE_COUNT).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd as number,
    change_7d: p.change_7d,
  }));
}

function ratioDisplay(table: PeerTable): RatioEntry[] {
  const entries: RatioEntry[] = [];
  for (const [category, bucket] of table.byCategory) {
    if (category === "") continue;
    entries.push({
      category,
      peers: bucket.length,
      median: round4dp(medianOf(bucket)),
      used: bucket.length >= PEER_FLOOR,
    });
  }
  entries.sort((a, b) => {
    if (b.peers !== a.peers) return b.peers - a.peers;
    return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
  });
  return entries;
}

export function buildRadar(snapshot: SnapshotFile): RadarResult {
  const table = buildPeerTable(snapshot.protocols);
  const wanted = new Set(snapshot.watchlist);
  const scored: {
    p: SnapshotProtocol;
    implied: number;
    breakdown: ModelBreakdown;
    onWatchlist: boolean;
  }[] = [];
  for (const p of snapshot.protocols) {
    const onWatchlist = wanted.has(p.slug);
    const early =
      !onWatchlist &&
      p.tvl_usd < snapshot.floor_usd &&
      passesStrictRule(p);
    if (!onWatchlist && !early) continue;
    const { implied, breakdown } = scoreOne(p, table, snapshot.as_of);
    scored.push({ p, implied, breakdown, onWatchlist });
  }
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });
  const boardRows: BoardRow[] = scored.map((entry, index) => {
    const { p, implied, breakdown, onWatchlist } = entry;
    const capital = capitalFor(p.tvl_usd);
    const steps = planFor(p, breakdown.age_days, capital);
    return {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: "pre-token",
      watchlist: onWatchlist,
      age_days: breakdown.age_days,
      implied_value_usd: implied,
      model: breakdown,
      farm_steps: steps,
    };
  });
  const dataRows: DataRow[] = boardRows.map((row) => ({
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    ratio: row.model.ratio,
    ratio_source: row.model.ratio_source,
    ratio_peers: row.model.ratio_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: row.watchlist,
    farm_steps: row.farm_steps,
  }));
  const live = liveTable(snapshot.protocols);
  const fallbackRows = boardRows.filter(
    (row) => row.model.ratio_source === "global",
  ).length;
  const fallbackWatchlist = boardRows.filter(
    (row) => row.watchlist && row.model.ratio_source === "global",
  ).length;
  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      growth_weight: GROWTH_HALF,
      growth_floor: GROWTH_LOW,
      growth_cap: GROWTH_HIGH,
      maturity_floor: SEASON_FLOOR,
      maturity_range: SEASON_SPAN,
      maturity_days: SEASON_DAYS,
      unknown_age_days: AGE_FALLBACK,
      min_peers: PEER_FLOOR,
      global_ratio: round4dp(table.globalMedian),
    },
    model_version: "radar-2",
    watchlist_size: snapshot.watchlist.length,
    board_size: boardRows.length,
    early_size: boardRows.length - snapshot.watchlist.length,
    live_size: live.length,
    fallback_rows: fallbackRows,
    fallback_watchlist: fallbackWatchlist,
    ratios: ratioDisplay(table),
    rows: dataRows,
    live,
  };
  return {
    boardRows,
    payload,
    protocolCount: snapshot.protocols.length,
    watchlistCount: snapshot.watchlist.length,
    earlyCount: boardRows.length - snapshot.watchlist.length,
    liveCount: live.length,
  };
}

// The board's own gate: ranks 1..N once each, implied values never rising
// with rank, the whole watchlist present, every row carrying a usable plan.
export function boardIssue(
  rows: BoardRow[],
  watchlist: string[],
): string | null {
  if (rows.length < 100) return `board has ${rows.length} rows, below the 100-row floor`;
  const seen = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  const slugs = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.rank)) return `rank ${row.rank} appears twice`;
    seen.add(row.rank);
    if (row.rank < 1 || row.rank > rows.length) {
      return `rank ${row.rank} is outside 1..${rows.length}`;
    }
    if (slugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (row.implied_value_usd <= 0) {
      return `row ${row.slug} has no positive implied value`;
    }
    if (row.implied_value_usd > previous) {
      return `implied value rises at rank ${row.rank}`;
    }
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (const slug of watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}
