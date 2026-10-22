// Proves the tests in a spec file are stable: runs the file ten times in a row against the same servers
// (each run resets the database, as every spec file does) and records, per test, how many runs it passed.
// A test counts as repeated only when it passed all ten.
//
//   node e2e/stress-check.mjs 12              # section 12: every test in e2e/12-*.spec.ts
//   node e2e/stress-check.mjs 01 "S01.05"     # only the tests whose title matches (a Playwright -g pattern)
//
// Writes e2e/evidence/stress.json, which coverage.mjs reads: { ran, runs: 10, passes: { "S12.05": 10 } },
// and per spec file the commit and fingerprint it ran on, so a spec edited afterwards shows as stale.
// Only plain passes count; skipped tests and known bugs (test.fail) are left out.
// Needs the test servers (npm run test:e2e starts them; with E2E_REUSE=1 they are reused).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, gitState } from "./fingerprint.mjs";

const RUNS = 10;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const section = process.argv[2]?.padStart(2, "0");
const grep = process.argv[3];
const specName = fs.readdirSync(here).find((f) => f.startsWith(`${section}-`) && f.endsWith(".spec.ts"));
if (!section || !specName) {
  console.error('Usage: node e2e/stress-check.mjs <section number> ["<title pattern>"], e.g. 12 or 01 "S01.05"');
  process.exit(2);
}
const spec = path.join(here, specName);
const source = fs.readFileSync(spec, "utf8");
// The Playwright CLI is run by node itself, not through a shell, so a pattern with | or spaces arrives intact.
const cli = path.join(web, "node_modules", "@playwright", "test", "cli.js");

/** One run of the file: for each checklist ID in a test title, whether every test naming it passed. */
function run() {
  const out = path.join(os.tmpdir(), `stress-${section}.json`);
  fs.rmSync(out, { force: true });
  spawnSync(process.execPath, [cli, "test", `e2e/${specName}`, "--reporter=json", ...(grep ? ["-g", grep] : [])], {
    cwd: web,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, E2E_REUSE: "1", PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  });
  const passed = {};
  if (!fs.existsSync(out)) return passed;
  const walk = (suite) => {
    for (const s of suite.specs ?? []) {
      for (const t of s.tests) {
        const status = t.results.at(-1)?.status;
        if (status === "skipped" || t.expectedStatus !== "passed") continue;
        for (const id of s.title.match(/S\d{2}\.\d{2}/g) ?? []) passed[id] = (passed[id] ?? true) && status === "passed";
      }
    }
    (suite.suites ?? []).forEach(walk);
  };
  JSON.parse(fs.readFileSync(out, "utf8")).suites.forEach(walk);
  return passed;
}

const runs = [];
for (let n = 1; n <= RUNS; n++) {
  const passed = run();
  runs.push(passed);
  const failed = Object.keys(passed).filter((id) => !passed[id]);
  const count = Object.keys(passed).length;
  console.log(`Run ${n}/${RUNS}: ${count ? `${count - failed.length} of ${count} passed` : "no results (Playwright did not finish)"}${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
}

// A test missing from a run (the run crashed) counts as not passing that run.
const ids = [...new Set(runs.flatMap((r) => Object.keys(r)))].sort();
const passes = Object.fromEntries(ids.map((id) => [id, runs.filter((r) => r[id] === true).length]));

// One entry per spec file. Results for the same spec text add to what is there; once the spec changes, the old ones go.
const file = path.join(here, "evidence", "stress.json");
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const specs = { ...old.specs };
const print = fingerprint(source);
const kept = specs[specName]?.fingerprint === print ? specs[specName].passes : {};
const ran = new Date().toISOString();
specs[specName] = { ran, ...gitState(web), fingerprint: print, passes: sortKeys({ ...kept, ...passes }) };
const sorted = sortKeys(specs);
const record = { ran, runs: RUNS, passes: sortKeys(Object.assign({}, ...Object.values(sorted).map((s) => s.passes))), specs: sorted };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

for (const id of ids) console.log(`${id}  ${passes[id]}/${RUNS}${passes[id] === RUNS ? "" : "  NOT STABLE"}`);
const unstable = ids.filter((id) => passes[id] < RUNS);
console.log(unstable.length ? `${unstable.length} not stable: ${unstable.join(", ")}` : ids.length ? `All ${ids.length} passed ${RUNS} runs in a row` : "No passing tests to record");
process.exit(unstable.length || !ids.length ? 1 : 0);

function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}
