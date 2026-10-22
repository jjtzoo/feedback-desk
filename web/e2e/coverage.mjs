/**
 * Which checklist items have a browser test, and how the last run went.
 *
 *   npm run test:e2e:coverage
 *
 * Reads the manual checklist (E2E_CHECKLIST, default Documents\Feedback test checklist.txt; never
 * written to), numbers every item S<section>.<item>, matches the IDs in test titles
 * (`playwright test --list`), adds the last result from e2e-results.json, and writes e2e/COVERAGE.md.
 * It also writes docs/testing/feature-evidence.md: per requirement of the brief (e2e/requirements.json), which items are
 * passing, shown able to fail (e2e/evidence/mutation-*.json; a record whose spec file has changed since is stale and
 * counts for nothing) and repeated (e2e/evidence/stress.json). Each run saves e2e/evidence/last-run.json: the commit,
 * whether the tree had uncommitted changes, and the counts.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, gitState } from "./fingerprint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..");
const CHECKLIST = process.env.E2E_CHECKLIST ?? path.join(os.homedir(), "Documents", "Feedback test checklist.txt");
const RESULTS = path.join(WEB_DIR, "e2e-results.json");
const OUT = path.join(HERE, "COVERAGE.md");
const REQUIREMENT_MAP = path.join(HERE, "requirements.json");
const REQUIREMENTS = path.join(WEB_DIR, "..", "docs", "requirements.md");
const EVIDENCE = path.join(HERE, "evidence");
const FEATURE_OUT = path.join(WEB_DIR, "..", "docs", "testing", "feature-evidence.md");
const REPEATS = 10;

const pad = (n) => String(n).padStart(2, "0");

/** Sections and items, numbered the way e2e/CLAUDE.md describes. */
function readChecklist() {
  const lines = readFileSync(CHECKLIST, "utf8").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  lines.forEach((line, i) => {
    const heading = /^(\d+)\. (.+)$/.exec(line);
    if (heading && /^-+$/.test(lines[i + 1] ?? "")) {
      current = { number: Number(heading[1]), title: heading[2].trim(), items: [] };
      sections.push(current);
      return;
    }
    if (/^[A-Z][A-Z ,'()]+$/.test(line) && /^-+$/.test(lines[i + 1] ?? "")) current = null; // NOT TESTABLE LOCALLY YET etc.
    const item = /^\[( |x)\] (.*)$/.exec(line);
    if (item && current) {
      const id = `S${pad(current.number)}.${pad(current.items.length + 1)}`;
      current.items.push({ id, ticked: item[1] === "x", text: item[2].trim() });
    }
  });
  return sections;
}

/** Every test, with the checklist IDs its title names. */
function listTests() {
  const raw = execSync("npx playwright test --list --reporter=json", { cwd: WEB_DIR, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  const tests = [];
  walk(JSON.parse(raw.toString()).suites ?? [], (spec) => tests.push({ title: spec.title, file: spec.file, ids: spec.title.match(/S\d{2}\.\d{2}/g) ?? [] }));
  return tests;
}

/** The last run's outcome per test title and file. */
function readResults() {
  const outcome = new Map();
  if (!existsSync(RESULTS)) return { outcome, at: null };
  const json = JSON.parse(readFileSync(RESULTS, "utf8"));
  walk(json.suites ?? [], (spec) => {
    for (const t of spec.tests ?? []) {
      const last = t.results?.at(-1);
      const fail = t.expectedStatus === "failed";
      const reason = (t.annotations ?? []).map((a) => a.description).filter(Boolean).join("; ");
      let result = "Not run";
      if (!last) result = "Not run";
      else if (last.status === "skipped") result = `Not automated${reason ? `: ${reason}` : ""}`;
      else if (fail) result = last.status === "failed" ? `Known bug (FINDINGS.md)${reason ? `: ${reason}` : ""}` : "Passes now: remove test.fail()";
      else result = last.status === "passed" ? "Pass" : "FAIL";
      outcome.set(`${spec.file}::${spec.title}`, result);
    }
  });
  return { outcome, at: json.stats?.startTime ?? null };
}

/**
 * Recorded runs behind the evidence report: e2e/evidence/mutation-sNN.json (mutation-check.mjs: breaking
 * the test's key assertion made it fail) and e2e/evidence/stress.json ({ ran, runs, passes: { ID: n } }:
 * how many identical runs in a row each test passed).
 */
function readEvidence() {
  const caught = new Map();
  const stale = [];
  const dates = [];
  let stress = { ran: null, runs: 0, passes: {} };
  if (existsSync(EVIDENCE)) {
    for (const file of readdirSync(EVIDENCE)) {
      const json = JSON.parse(readFileSync(path.join(EVIDENCE, file), "utf8"));
      if (file.startsWith("mutation-")) {
        dates.push(json.ran);
        const spec = path.join(HERE, json.spec);
        const current = existsSync(spec) && json.fingerprint === fingerprint(readFileSync(spec, "utf8"));
        if (!current) stale.push(json.spec);
        for (const [id, ok] of Object.entries(json.caught)) caught.set(id, current ? ok : "stale");
      } else if (file === "stress.json") stress = json;
    }
  }
  return { caught, stale, mutationRan: dates.sort().at(-1) ?? null, stress };
}

/** The checklist IDs a requirement lists: "S03.15", "S03.09-S03.14" or "S12.*" (the whole section). */
function expandItems(tokens, sections) {
  const all = sections.flatMap((s) => s.items.map((i) => i.id));
  const ids = new Set();
  for (const token of tokens ?? []) {
    const whole = /^S(\d{2})\.\*$/.exec(token);
    const range = /^S(\d{2})\.(\d{2})-S\1\.(\d{2})$/.exec(token);
    const wanted = whole
      ? all.filter((id) => id.startsWith(`S${whole[1]}.`))
      : range
        ? all.filter((id) => id.startsWith(`S${range[1]}.`) && id.slice(4) >= range[2] && id.slice(4) <= range[3])
        : all.filter((id) => id === token);
    if (!wanted.length) throw new Error(`${path.basename(REQUIREMENT_MAP)}: "${token}" matches no checklist item`);
    wanted.forEach((id) => ids.add(id));
  }
  return ids;
}

/** Evidence per requirement of the brief (docs/requirements.md): what backs each claim that it works, and what does not yet. */
function writeEvidenceReport(sections, tests, outcome, at) {
  const requirements = JSON.parse(readFileSync(REQUIREMENT_MAP, "utf8"));
  const { caught, stale, mutationRan, stress } = readEvidence();
  const { commit, uncommitted } = gitState(WEB_DIR);
  const repeated = (id) => stress.runs >= REPEATS && (stress.passes[id] ?? 0) >= stress.runs;
  const byId = new Map(sections.flatMap((s) => s.items.map((item) => [item.id, item])));
  // The wording comes from docs/requirements.md (the index of Marc's brief), so it is never retyped here.
  const names = new Map([...readFileSync(REQUIREMENTS, "utf8").matchAll(/^\| (F\d+) \| (.+?) \| \d \|/gm)].map((m) => [m[1], m[2]]));

  /** One checklist item's evidence. */
  const evidence = (id) => {
    const mine = tests.filter((t) => t.ids.includes(id));
    const results = mine.map((t) => outcome.get(`${t.file}::${t.title}`) ?? "Not run");
    const pass = results.length > 0 && results.every((r) => r === "Pass");
    return {
      item: byId.get(id),
      result: results.length ? [...new Set(results)].join("; ") : "No test",
      tested: mine.length > 0,
      pass,
      bug: results.some((r) => r.startsWith("Known bug")),
      canFail: pass ? caught.get(id) : undefined,
      repeats: pass && repeated(id),
    };
  };
  const count = (rows, f) => rows.filter(f).length;
  const pressureTested = (r) => r.pass && r.canFail === true && r.repeats;
  const dash = (n) => n || "—";

  const mapped = new Set();
  const summary = [];
  const details = [];
  for (const req of requirements) {
    const ids = expandItems(req.items, sections);
    ids.forEach((id) => mapped.add(id));
    const rows = [...ids].map(evidence);
    const status = !rows.length || count(rows, (r) => r.tested) === 0 ? "Not covered" : count(rows, pressureTested) === rows.length ? "Pressure-tested" : "Partly evidenced";
    const name = names.get(req.id) ?? req.name;
    summary.push(
      `| ${req.id} | ${cell(name)} | ${dash(rows.length)} | ${dash(count(rows, (r) => r.tested))} | ${dash(count(rows, (r) => r.pass))} | ${dash(count(rows, (r) => r.canFail === true))} | ${dash(count(rows, (r) => r.repeats))} | ${dash(count(rows, (r) => r.bug))} | **${status}** |`,
    );

    details.push(`### ${req.id}: ${name}`, "");
    if (!rows.length) {
      details.push(`Not covered: ${req.note ?? "no checklist item"}.`, "");
      continue;
    }
    details.push(`Evidence: **${status}**. ${count(rows, pressureTested)} of ${rows.length} items have passed, been shown able to fail, and repeated ${REPEATS} times in a row.`, "");
    const bugs = rows.filter((r) => r.bug);
    if (bugs.length) details.push("Known bugs (details in `web/e2e/FINDINGS.md`):", ...bugs.map((r) => `- ${r.item.id}: ${r.item.text}`), "");
    details.push("| ID | Checklist item | Test result | Can fail | Repeated |", "| --- | --- | --- | :---: | :---: |");
    for (const r of rows) {
      const text = r.item.text.length > 100 ? `${r.item.text.slice(0, 97)}…` : r.item.text;
      const canFail = !r.pass ? "—" : r.canFail === true ? "Yes" : r.canFail === false ? "NO" : r.canFail === "stale" ? "Stale: spec changed since" : "Not recorded";
      details.push(`| ${r.item.id} | ${cell(text)} | ${cell(r.result)} | ${canFail} | ${r.pass ? (r.repeats ? `${stress.runs}/${stress.runs}` : "Not yet") : "—"} |`);
    }
    details.push("");
  }
  const unmapped = [...byId.keys()].filter((id) => !mapped.has(id));

  const out = [
    "# Evidence by requirement",
    "",
    `Generated by \`npm run test:e2e:coverage\` from the manual checklist, \`web/e2e/requirements.json\` (which checklist items back which requirement of [requirements.md](../requirements.md), the index of the project brief and build spec), the last test run${at ? ` (started ${at}; this report made on commit ${commit}${uncommitted ? " with uncommitted changes" : ""})` : " (none yet)"} and the records in \`web/e2e/evidence/\`. Do not edit by hand.`,
    "",
    "A checklist item counts as **pressure-tested** only when all of these hold:",
    "",
    "1. **Automated and passing:** a browser test names the item and passed in the last full run.",
    `2. **Can fail:** one key assertion was broken on purpose and the test failed (\`npm run test:e2e:mutation -- NN\`${mutationRan ? `, last recorded ${mutationRan}` : ", none recorded yet"}).`,
    `3. **Repeats:** it passed ${REPEATS} identical runs in a row (\`evidence/stress.json\`${stress.ran ? `, last recorded ${stress.ran}` : ", none recorded yet"}).`,
    "",
    ...(stale.length ? [`**Stale records:** ${stale.join(", ")} changed after their mutation check, so their "Can fail" is not counted until \`npm run test:e2e:mutation\` is run again for them.`, ""] : []),
    "A requirement is **Pressure-tested** when every one of its items is, **Partly evidenced** when some have tests, and **Not covered** when none do. Known bugs, items that cannot be automated here and items without a test keep a requirement from being pressure-tested. An item that backs two requirements counts in both.",
    "",
    "What this does not show: every test uses the scripted stub model against a local test database. None ran on staging or against Gemini, and passing browser tests do not replace the sprint gates (signed by Marc and Chris) or the pre-deployment checklist in `docs/deployment.md`. F18 (launch) is checked here only through the Guide tour; the pilot, the intranet tile and production are not browser-testable.",
    "",
    "| Requirement | What the app must do | Items | Automated | Passing | Can fail | Repeated | Known bugs | Evidence |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summary,
    "",
    ...(unmapped.length ? ["## Checklist items backing no requirement", "", ...unmapped.map((id) => `- ${id}: ${byId.get(id).text}`), ""] : []),
    "## Detail",
    "",
    ...details,
  ];
  mkdirSync(path.dirname(FEATURE_OUT), { recursive: true });
  writeFileSync(FEATURE_OUT, out.join("\n"));
  if (unmapped.length) console.warn(`${unmapped.length} checklist items back no requirement in ${path.basename(REQUIREMENT_MAP)}: ${unmapped.join(", ")}`);
}

/** The dated record of the last run, kept in git so each run's commit and counts stay on file. */
function saveRun(outcome, at) {
  if (!at) return;
  const results = [...outcome.values()];
  const count = (f) => results.filter(f).length;
  const run = {
    started: at,
    ...gitState(WEB_DIR),
    tests: results.length,
    passed: count((r) => r === "Pass"),
    knownBugs: count((r) => r.startsWith("Known bug")),
    skipped: count((r) => r.startsWith("Not automated")),
    failed: count((r) => r === "FAIL" || r === "Not run" || r.startsWith("Passes now")),
  };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(path.join(EVIDENCE, "last-run.json"), `${JSON.stringify(run, null, 2)}
`);
}

function walk(suites, onSpec) {
  for (const s of suites) {
    for (const spec of s.specs ?? []) onSpec(spec);
    walk(s.suites ?? [], onSpec);
  }
}

const cell = (s) => s.replace(/\|/g, "\\|");

function main() {
  const sections = readChecklist();
  const tests = listTests();
  const { outcome, at } = readResults();
  const known = new Set(sections.flatMap((s) => s.items.map((i) => i.id)));

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const covered = sections.reduce((n, s) => n + s.items.filter((i) => tests.some((t) => t.ids.includes(i.id))).length, 0);

  const out = [
    "# Browser test coverage of the manual checklist",
    "",
    `Generated by \`npm run test:e2e:coverage\` from \`${path.basename(CHECKLIST)}\`${at ? `; results from the run started ${at}` : "; no run results yet"}. Do not edit by hand.`,
    "",
    `**${covered} of ${total}** checklist items have a browser test. Items under "Not testable locally yet" in the checklist are out of scope.`,
    "",
    "| Section | Items | With a test | Pass | Known bug | Not automated |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  const rows = [];
  for (const s of sections) {
    const counts = { tested: 0, pass: 0, bug: 0, skip: 0 };
    const lines = [`### ${s.number}. ${s.title}`, "", "| ID | Item | Manual | Test | Result |", "| --- | --- | :---: | --- | --- |"];
    for (const item of s.items) {
      const mine = tests.filter((t) => t.ids.includes(item.id));
      const results = mine.map((t) => outcome.get(`${t.file}::${t.title}`) ?? "Not run");
      if (mine.length) counts.tested++;
      if (results.length && results.every((r) => r === "Pass")) counts.pass++;
      if (results.some((r) => r.startsWith("Known bug"))) counts.bug++;
      if (results.some((r) => r.startsWith("Not automated"))) counts.skip++;
      const text = item.text.length > 110 ? `${item.text.slice(0, 107)}…` : item.text;
      lines.push(
        `| ${item.id} | ${cell(text)} | ${item.ticked ? "x" : ""} | ${mine.map((t) => cell(`${t.file}: ${t.title.replace(/^(S\d{2}\.\d{2}\+?)+ /, "")}`)).join("<br>") || "—"} | ${cell(results.join("<br>")) || "No test"} |`,
      );
    }
    out.push(`| ${s.number}. ${s.title} | ${s.items.length} | ${counts.tested} | ${counts.pass} | ${counts.bug} | ${counts.skip} |`);
    rows.push(...lines, "");
  }
  const stray = tests.filter((t) => t.ids.some((id) => !known.has(id)));
  out.push("", ...rows);
  if (stray.length) {
    out.push("## Tests naming an ID that is not in the checklist", "", ...stray.map((t) => `- ${t.file}: ${t.title}`), "");
  }
  writeFileSync(OUT, out.join("\n"));
  writeEvidenceReport(sections, tests, outcome, at);
  saveRun(outcome, at);
  console.log(`${covered}/${total} checklist items have a test. Wrote ${path.relative(WEB_DIR, OUT)} and ${path.relative(WEB_DIR, FEATURE_OUT)}.`);
}

main();
