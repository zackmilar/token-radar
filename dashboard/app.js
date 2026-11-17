// Token Radar — dashboard behaviour.
//
// Reads the board the program wrote into window.RADAR and renders it:
// facts, a top-three spotlight, a searchable / filterable / sortable board,
// a per-protocol detail view that re-derives the row's value in the page,
// a live-token table kept apart from the ranked board, and the model panel.
// No network is used: everything comes from data.js beside this page.

const RADAR = window.RADAR;
const boardRows = RADAR.rows;
const liveRows = RADAR.live;

const queryInput = document.getElementById("query");
const categorySelect = document.getElementById("category");
const countLine = document.getElementById("count");
const rowsBody = document.getElementById("rows");
const liveBody = document.getElementById("live-rows");
const boardTable = document.getElementById("board");
const liveTable = document.getElementById("live");
const detailBox = document.getElementById("detail");

const state = {
  scope: "all",
  tab: "pre",
  query: "",
  category: "",
  sortKey: "rank",
  sortDir: 1,
  slug: "",
};

function moneyFull(value) {
  return "$" + Math.round(value).toLocaleString("en-US");
}

function moneyShort(value) {
  if (value >= 1e9) return "$" + (value / 1e9).toFixed(1) + "B";
  if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
  if (value >= 1e3) return "$" + (value / 1e3).toFixed(1) + "K";
  return "$" + Math.round(value);
}

function pctText(pct) {
  if (pct === null || pct === undefined) return "—";
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(2) + "%";
}

function ageText(days) {
  if (days === null || days === undefined) return "unknown";
  if (days < 365) return days + "d";
  const years = (days / 365).toFixed(1);
  return years + "y";
}

function escapeText(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ratioNote(row) {
  if (row.ratio_source === "category") {
    return "category median, " + row.ratio_peers + " priced peers";
  }
  const peers = row.ratio_peers;
  const noun = peers === 1 ? "priced peer" : "priced peers";
  return "global median — category has " + peers + " " + noun + ", below the 3-peer bar";
}

function growthOf(row) {
  const weekly = row.change_7d === null ? 0 : row.change_7d;
  const clamped = Math.max(-60, Math.min(120, weekly));
  return 1 + clamped / 100 * 0.5;
}

function maturityOf(row) {
  const age = row.age_days === null ? 365 : row.age_days;
  return 0.6 + Math.min(age, 1095) / 1095 * 0.4;
}

function recomputeRow(row) {
  return Math.max(
    1,
    Math.round(row.tvl_usd * row.ratio * growthOf(row) * maturityOf(row)),
  );
}

function paintFacts() {
  const top = boardRows[0];
  const facts = document.getElementById("facts");
  const items = [
    ["Watchlist", RADAR.watchlist_size + " / " + RADAR.watchlist_size],
    ["Board", RADAR.board_size + " rows"],
    ["Early radar", RADAR.early_size + " rows"],
    ["Live tokens", RADAR.live_size + " set aside"],
    ["Top value", moneyShort(top.implied_value_usd)],
    ["Snapshot", RADAR.as_of],
  ];
  facts.innerHTML = items
    .map(([label, value]) => "<div><dt>" + label + "</dt><dd>" + value + "</dd></div>")
    .join("");
}

function paintSpotlight() {
  const holder = document.getElementById("spotlight");
  holder.innerHTML = boardRows
    .slice(0, 3)
    .map((row) => {
      const why =
        row.category +
        " · ratio " +
        row.ratio.toFixed(4) +
        " (" +
        ratioNote(row) +
        ") · " +
        pctText(row.change_7d) +
        " in 7 days";
      return (
        '<button type="button" class="spot" data-slug="' +
        escapeText(row.slug) +
        '">' +
        '<span class="place">Rank ' +
        row.rank +
        "</span><h2>" +
        escapeText(row.name) +
        '</h2><span class="value">' +
        moneyShort(row.implied_value_usd) +
        '</span><p class="why">' +
        escapeText(why) +
        "</p></button>"
      );
    })
    .join("");
  holder.querySelectorAll(".spot").forEach((card) => {
    card.addEventListener("click", () => openProtocol(card.dataset.slug));
  });
}

function paintCategories() {
  const names = [...new Set(boardRows.map((row) => row.category))].sort();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  }
}

function visibleRows() {
  const needle = state.query.trim().toLowerCase();
  let pool = boardRows.filter((row) => {
    if (state.scope === "watchlist" && !row.watchlist) return false;
    if (state.scope === "early" && row.watchlist) return false;
    if (state.category && row.category !== state.category) return false;
    if (needle) {
      const hay = (row.name + " " + row.slug + " " + row.chains.join(" ")).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const key = state.sortKey;
  pool = [...pool].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string") return av.localeCompare(bv) * state.sortDir;
    return (av - bv) * state.sortDir;
  });
  return pool;
}

function paintTable() {
  const pool = visibleRows();
  countLine.textContent =
    pool.length +
    " row" +
    (pool.length === 1 ? "" : "s") +
    " shown of " +
    boardRows.length;
  rowsBody.innerHTML = pool
    .map((row) => {
      const change = row.change_7d;
      const changeClass = change === null ? "" : change < 0 ? "neg" : "pos";
      const tag = row.watchlist
        ? '<span class="tag">Watchlist</span>'
        : '<span class="tag early">Early</span>';
      return (
        '<tr data-slug="' +
        escapeText(row.slug) +
        '"><td class="num">' +
        row.rank +
        "</td><td>" +
        escapeText(row.name) +
        tag +
        "</td><td>" +
        escapeText(row.category) +
        '</td><td class="num">' +
        moneyShort(row.tvl_usd) +
        '</td><td class="num ' +
        changeClass +
        '">' +
        pctText(change) +
        '</td><td class="num">' +
        ageText(row.age_days) +
        '</td><td class="num">' +
        moneyShort(row.implied_value_usd) +
        '</td><td class="num">' +
        row.ratio.toFixed(4) +
        "</td></tr>"
      );
    })
    .join("");
  rowsBody.querySelectorAll("tr").forEach((line) => {
    line.addEventListener("click", () => openProtocol(line.dataset.slug));
  });
  document.querySelectorAll("#board th[data-sort]").forEach((head) => {
    const key = head.dataset.sort;
    head.textContent = head.textContent.replace(/ [▲▼]$/, "");
    if (key === state.sortKey) {
      head.textContent += state.sortDir === 1 ? " ▲" : " ▼";
    }
  });
}

function paintLive() {
  liveBody.innerHTML = liveRows
    .map((row) => {
      const change = row.change_7d;
      const changeClass = change === null ? "" : change < 0 ? "neg" : "pos";
      return (
        "<tr><td>" +
        escapeText(row.name) +
        "</td><td>" +
        escapeText(row.category) +
        '</td><td class="num">' +
        moneyShort(row.tvl_usd) +
        '</td><td class="num">' +
        moneyFull(row.mcap_usd) +
        '</td><td class="num ' +
        changeClass +
        '">' +
        pctText(change) +
        "</td></tr>"
      );
    })
    .join("");
}

function paintModel() {
  const panel = document.getElementById("model");
  const tableRows = RADAR.ratios
    .map((entry) => {
      const use = entry.used ? "used" : "fallback — too few peers";
      return (
        "<tr><td>" +
        escapeText(entry.category) +
        '</td><td class="num">' +
        entry.peers +
        '</td><td class="num">' +
        entry.median.toFixed(4) +
        "</td><td>" +
        use +
        "</td></tr>"
      );
    })
    .join("");
  panel.innerHTML =
    "<h2>How the value is worked out</h2>" +
    '<p class="formula">implied value = TVL × ratio × growth × maturity</p>' +
    "<p><strong>Ratio.</strong> The median market-cap / TVL of the priced protocols in " +
    "the same category, when that category has at least 3 of them. Otherwise the " +
    "median over all 128 priced protocols, " +
    RADAR.model.global_ratio.toFixed(4) +
    ". A category of one is a single anecdote, not a market — so its rows fall back " +
    "to the global median, and the page says so on every row.</p>" +
    "<p><strong>Growth.</strong> The 7-day TVL change, clamped to −60% … +120% and " +
    "counted at half weight, so one week cannot own a ranking.</p>" +
    "<p><strong>Maturity.</strong> 0.6 plus up to 0.4 spread over 1,095 days with no " +
    "token. A protocol tracked for three years without launching counts for more " +
    "of its multiple than a 45-day-old one; a missing listing date counts as a year.</p>" +
    "<p>" +
    RADAR.fallback_rows +
    " of the " +
    RADAR.board_size +
    " board rows (" +
    RADAR.fallback_watchlist +
    " of the " +
    RADAR.watchlist_size +
    " watchlist rows) use the global median. The top of the board is therefore " +
    "mostly TVL times the global median — the honest limit of what this " +
    "snapshot's own comparables support.</p>" +
    "<table><thead><tr><th>Category</th><th>Priced peers</th><th>Median ratio</th><th>Standing</th></tr></thead>" +
    "<tbody>" +
    tableRows +
    "</tbody></table>";
}

function openProtocol(slug) {
  const row = boardRows.find((entry) => entry.slug === slug);
  if (row === undefined) return;
  state.slug = slug;
  writeState();
  const again = recomputeRow(row);
  const match =
    again === row.implied_value_usd
      ? "The page recomputes this row as " +
        moneyShort(again) +
        ", the same number the board carries."
      : "The page recomputes this row as " +
        moneyShort(again) +
        ", against " +
        moneyShort(row.implied_value_usd) +
        " in the board.";
  const ageLine =
    row.age_days === null
      ? "listing date not reported (counts as 365 days)"
      : row.age_days + " days since listing";
  detailBox.innerHTML =
    '<div class="detail-body"><button type="button" class="close-btn">Close</button>' +
    "<h2>" +
    escapeText(row.name) +
    "</h2>" +
    '<p class="sub">Rank ' +
    row.rank +
    " · " +
    escapeText(row.category) +
    " · " +
    escapeText(row.chains.join(", ")) +
    " · " +
    (row.watchlist ? "watchlist" : "early radar") +
    "</p>" +
    '<div class="equation">' +
    moneyFull(row.tvl_usd) +
    " TVL<br>× ratio " +
    row.ratio.toFixed(4) +
    " (" +
    escapeText(ratioNote(row)) +
    ")<br>× growth " +
    row.growth_multiplier.toFixed(4) +
    " (" +
    pctText(row.change_7d) +
    ")<br>× maturity " +
    row.maturity_multiplier.toFixed(4) +
    " (" +
    ageLine +
    ")<br>= <strong>" +
    moneyFull(row.implied_value_usd) +
    "</strong></div>" +
    '<p class="sub">' +
    match +
    "</p>" +
    '<dl class="kv">' +
    "<div><dt>TVL</dt><dd>" +
    moneyFull(row.tvl_usd) +
    "</dd></div>" +
    "<div><dt>Implied value</dt><dd>" +
    moneyFull(row.implied_value_usd) +
    "</dd></div>" +
    "<div><dt>Ratio</dt><dd>" +
    row.ratio.toFixed(4) +
    "</dd></div>" +
    "</dl>" +
    "<h3>How to farm it</h3><ol>" +
    row.farm_steps.map((step) => "<li>" + escapeText(step) + "</li>").join("") +
    "</ol></div>";
  detailBox.querySelector(".close-btn").addEventListener("click", () => {
    detailBox.close();
    state.slug = "";
    writeState();
  });
  detailBox.showModal();
}

function readState() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get("scope")) state.scope = hash.get("scope");
  if (hash.get("tab")) state.tab = hash.get("tab");
  if (hash.get("q") !== null) state.query = hash.get("q");
  if (hash.get("cat") !== null) state.category = hash.get("cat");
  if (hash.get("sort")) state.sortKey = hash.get("sort");
  if (hash.get("dir") === "-1") state.sortDir = -1;
  if (hash.get("row")) state.slug = hash.get("row");
}

function writeState() {
  const hash = new URLSearchParams();
  hash.set("scope", state.scope);
  hash.set("tab", state.tab);
  if (state.query) hash.set("q", state.query);
  if (state.category) hash.set("cat", state.category);
  if (state.sortKey !== "rank") hash.set("sort", state.sortKey);
  if (state.sortDir === -1) hash.set("dir", "-1");
  if (state.slug) hash.set("row", state.slug);
  history.replaceState(null, "", "#" + hash.toString());
}

function applyTab() {
  const pre = state.tab === "pre";
  boardTable.hidden = !pre;
  liveTable.hidden = pre;
  countLine.hidden = !pre;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.tab === state.tab);
  });
  document.querySelectorAll("[data-scope]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.scope === state.scope);
  });
}

function refresh() {
  applyTab();
  if (state.tab === "pre") paintTable();
}

readState();
queryInput.value = state.query;
categorySelect.value = state.category;
paintFacts();
paintSpotlight();
paintCategories();
paintModel();
paintLive();
refresh();

queryInput.addEventListener("input", () => {
  state.query = queryInput.value;
  writeState();
  refresh();
});

categorySelect.addEventListener("change", () => {
  state.category = categorySelect.value;
  writeState();
  refresh();
});

document.querySelectorAll("[data-scope]").forEach((button) => {
  button.addEventListener("click", () => {
    state.scope = button.dataset.scope;
    writeState();
    refresh();
  });
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    writeState();
    refresh();
  });
});

document.querySelectorAll("#board th[data-sort]").forEach((head) => {
  head.addEventListener("click", () => {
    const key = head.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = -state.sortDir;
    } else {
      state.sortKey = key;
      state.sortDir = 1;
    }
    writeState();
    refresh();
  });
});

detailBox.addEventListener("close", () => {
  if (state.slug) {
    state.slug = "";
    writeState();
  }
});

if (state.slug) openProtocol(state.slug);
