// Proves each test in a spec file can fail: breaks one key assertion per test, runs the file, and
// expects every broken test to FAIL. The spec is always put back, even on error.
//
//   node e2e/mutation-check.mjs 04          # section 4: e2e/04-*.spec.ts with e2e/mutations/s04.json
//
// A mutation file maps a test ID to [text, replacement] or [text, replacement, n]: the n-th line (default
// the first) after the test's title line that contains the text has it replaced. Line numbers are
// not stored, so the file survives edits to the specs. "_each": true runs one test per run, for files
// whose tests depend on each other (serial mode skips everything after the first failure).
// Needs the test servers (npm run test:e2e starts them; with E2E_REUSE=1 they are reused).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const section = process.argv[2]?.padStart(2, "0");
const specName = fs.readdirSync(here).find((f) => f.startsWith(`${section}-`) && f.endsWith(".spec.ts"));
if (!section || !specName) {
  console.error("Usage: node e2e/mutation-check.mjs <section number>, e.g. 04");
  process.exit(2);
}
const spec = path.join(here, specName);
const original = fs.readFileSync(spec, "utf8");
const { _each: each = false, ...mutations } = JSON.parse(fs.readFileSync(path.join(here, "mutations", `s${section}.json`), "utf8"));

/** The spec's text with one mutation applied, or an error message. */
function mutate(source, id, [from, to, n = 1]) {
  const lines = source.split("\n");
  let i = lines.findIndex((l) => l.includes(`"${id} `) || l.includes(`\`${id} `));
  if (i < 0) return { error: `${id}: no test with that ID` };
  // From the line after the title, so text that is also in the title is never what gets broken.
  for (let seen = 0, line = i + 1; line < lines.length; line++) {
    if (lines[line].includes(from) && ++seen === n) {
      lines[line] = lines[line].replace(from, to);
      return { text: lines.join("\n") };
    }
  }
  return { error: `${id}: "${from}" not found after the test's title (occurrence ${n})` };
}

function run(grep) {
  const out = path.join(os.tmpdir(), `mutation-${section}.json`);
  fs.rmSync(out, { force: true });
  spawnSync("npx", ["playwright", "test", path.relative(web, spec).split(path.sep).join("/"), "--reporter=json", ...(grep ? ["-g", `${grep} `] : [])], {
    cwd: web,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, E2E_REUSE: "1", PLAYWRIGHT_JSON_OUTPUT_NAME: out },
  });
  if (!fs.existsSync(out)) throw new Error("Playwright produced no result file");
  const status = {};
  const walk = (suite) => {
    for (const s of suite.specs ?? []) status[s.title.match(/S\d{2}\.\d{2}/)?.[0]] = s.tests[0].results.at(-1)?.status ?? "none";
    (suite.suites ?? []).forEach(walk);
  };
  JSON.parse(fs.readFileSync(out, "utf8")).suites.forEach(walk);
  return status;
}

const results = {};
try {
  const batches = each ? Object.keys(mutations).map((id) => [id]) : [Object.keys(mutations)];
  for (const ids of batches) {
    let text = original;
    for (const id of ids) {
      const m = mutate(text, id, mutations[id]);
      if (m.error) throw new Error(m.error);
      text = m.text;
    }
    fs.writeFileSync(spec, text);
    const status = run(each ? ids[0] : null);
    for (const id of ids) results[id] = status[id];
  }
} finally {
  fs.writeFileSync(spec, original);
}

let hollow = 0;
const record = {};
for (const [id, status] of Object.entries(results)) {
  const caught = status === "failed" || status === "timedOut";
  if (!caught) hollow++;
  record[id] = caught;
  console.log(`${id}  broken -> ${status}  ${caught ? "caught" : "NOT CAUGHT"}`);
}
// The record the evidence report reads: when it ran, and for each test whether breaking it made it fail.
fs.mkdirSync(path.join(here, "evidence"), { recursive: true });
fs.writeFileSync(path.join(here, "evidence", `mutation-s${section}.json`), `${JSON.stringify({ ran: new Date().toISOString(), spec: specName, caught: record }, null, 2)}\n`);
console.log(hollow ? `${hollow} not caught: those tests would pass with the feature broken` : `All ${Object.keys(results).length} broken tests failed, as they should`);
process.exit(hollow ? 1 : 0);
