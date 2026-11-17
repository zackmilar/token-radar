// Token launch radar — program entry point (Node 22, standard library only).
//
// Reads the sealed snapshot, scores the pre-token board, and writes the
// entry's outputs:
//
//   board.json    the ranked board (watchlist + strict early rows)
//   data.js       the same board as one script the dashboard reads
//   dashboard/    a copy of this repo's dashboard/
//   screenshots/  a copy of this repo's screenshots/
//   dossier.json  written by the vendored buildDossier library
//
// Run it from anywhere; the dashboard and screenshots are found next to
// this file, not in the working directory. Flags:
//
//   --input <path>   snapshot to read (default /input/snapshot.json)
//   --output <dir>   directory to write (default $MAKEFUN_OUTPUT_DIR,
//                      else /output)
//
// The run is deterministic: same snapshot in, same bytes out. It uses no
// network, no clock (age comes from the snapshot's own as_of date), and no
// randomness, so running it twice writes identical files.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { boardIssue, buildRadar } from "./lib/model.ts";
import type { SnapshotFile } from "./lib/model.ts";

const FALLBACK_INPUT = "/input/snapshot.json";
const FALLBACK_OUTPUT = "/output";
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const DOSSIER_TEXT_CAP = 65536;

function flagValue(argv: string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1 || at + 1 >= argv.length) return null;
  return argv[at + 1];
}

function countTree(root: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walk(root);
  return { files, bytes };
}

function fail(message: string, code: number): never {
  console.error(`token radar: ${message}`);
  process.exitCode = code;
  throw new Error(message);
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const inputPath =
    flagValue(argv, "--input") ?? FALLBACK_INPUT;
  const outputDir = resolve(
    flagValue(argv, "--output") ??
      process.env.MAKEFUN_OUTPUT_DIR ??
      FALLBACK_OUTPUT,
  );
  const here = dirname(fileURLToPath(import.meta.url));
  const dashboardSrc = join(here, "dashboard");
  const screenshotsSrc = join(here, "screenshots");

  if (!existsSync(inputPath)) {
    fail(`snapshot not found at ${inputPath}`, 1);
  }
  const snapshot = JSON.parse(
    readFileSync(inputPath, "utf-8"),
  ) as SnapshotFile;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    fail("snapshot is missing its protocols or watchlist arrays", 1);
  }

  const radar = buildRadar(snapshot);
  const issue = boardIssue(radar.boardRows, snapshot.watchlist);
  if (issue !== null) {
    fail(`board refused: ${issue}`, 2);
  }

  const dashboardSize = countTree(dashboardSrc);
  if (dashboardSize.files > DASHBOARD_MAX_FILES) {
    fail(`dashboard has ${dashboardSize.files} files, over the 400-file cap`, 1);
  }
  if (dashboardSize.bytes > DASHBOARD_MAX_BYTES) {
    fail(`dashboard is ${dashboardSize.bytes} bytes, over the 4 MiB cap`, 1);
  }
  const shots = readdirSync(screenshotsSrc).filter((name) =>
    /\.(png|jpg|jpeg)$/i.test(name),
  );
  if (shots.length < 3) {
    fail(`screenshots has ${shots.length} images, fewer than the 3 required`, 1);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, "board.json"),
    JSON.stringify({ rows: radar.boardRows }) + "\n",
    "utf-8",
  );
  writeFileSync(
    join(outputDir, "data.js"),
    "window.RADAR=" + JSON.stringify(radar.payload) + ";\n",
    "utf-8",
  );
  cpSync(dashboardSrc, join(outputDir, "dashboard"), { recursive: true });
  cpSync(screenshotsSrc, join(outputDir, "screenshots"), { recursive: true });
  // buildDossier returns the dossier bytes; this file writes them out.
  const dossierBytes = await buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_CAP,
  });
  writeFileSync(join(outputDir, "dossier.json"), dossierBytes);

  console.log(
    `token radar: ${radar.protocolCount} protocols, ${radar.watchlistCount} on the watchlist, ${radar.boardRows.length} rows scored (${radar.earlyCount} early, ${radar.liveCount} live set aside)`,
  );
  console.log(
    `token radar: wrote ${join(outputDir, "board.json")}, ${join(outputDir, "data.js")}, ${join(outputDir, "dashboard")} (${dashboardSize.files} files), ${join(outputDir, "screenshots")} (${shots.length} images) and ${join(outputDir, "dossier.json")}`,
  );
}

try {
  await run();
} catch (err) {
  if (process.exitCode === undefined || process.exitCode === 0) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`token radar: failed: ${detail}`);
    process.exitCode = 1;
  }
}
