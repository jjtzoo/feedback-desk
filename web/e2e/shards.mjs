/**
 * The whole browser suite, split into shards that run at the same time.
 *
 *   npm run test:e2e:full                 E2E_SHARDS shards (default 2)
 *   E2E_SHARDS=3 npm run test:e2e:full
 *
 * The specs share one database and reset it, so they cannot run in parallel inside one Playwright
 * run. Each shard is its own run instead: its own API, web server and database (fd_e2e_<n>), on
 * ports 87<n>2 (API), 37<n>0 (web) and 87<n>9 (supervisor). The web build is made once, into
 * .next-e2e, and every shard's `next start` serves it (the proxy reads API_ORIGIN per request).
 * Spec files go to shards by their durations in the last e2e-results.json, longest first. At the
 * end the shards' blob reports are merged into e2e-results.json and playwright-report, as one
 * run would leave them, so `npm run test:e2e:coverage` reads the merged result.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..");
const BACKEND_DIR = path.join(WEB_DIR, "..", "backend");
const RESULTS = path.join(WEB_DIR, "e2e-results.json");
const BLOBS = path.join(WEB_DIR, "blob-report");
const SHARDS = Number(process.env.E2E_SHARDS ?? 2);
if (!Number.isInteger(SHARDS) || SHARDS < 1 || SHARDS > 9) throw new Error("E2E_SHARDS must be 1 to 9");

const started = Date.now();
const seconds = () => `${Math.round((Date.now() - started) / 1000)} s`;

/** Run a command to the end; lines are prefixed with `tag` so the shards' output stays apart. */
function run(tag, command, args, { cwd = WEB_DIR, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32" });
    for (const stream of [child.stdout, child.stderr]) {
      let rest = "";
      stream.on("data", (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) if (line.trim()) console.log(`[${tag}] ${line}`);
      });
      stream.on("end", () => rest.trim() && console.log(`[${tag}] ${rest}`));
    }
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Seconds per spec file in the last run; files it did not include count as the median. */
function specDurations(files) {
  const known = new Map();
  if (existsSync(RESULTS)) {
    const walk = (suites) => {
      for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
          const ms = spec.tests.flatMap((t) => t.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0);
          known.set(spec.file, (known.get(spec.file) ?? 0) + ms);
        }
        walk(suite.suites);
      }
    };
    walk(JSON.parse(readFileSync(RESULTS, "utf8")).suites);
  }
  const values = [...known.values()].sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] ?? 1;
  return new Map(files.map((f) => [f, known.get(f) || median]));
}

/** Longest file first onto the least-loaded shard. */
function assign(files) {
  const durations = specDurations(files);
  const shards = Array.from({ length: SHARDS }, () => ({ files: [], ms: 0 }));
  for (const file of [...files].sort((a, b) => durations.get(b) - durations.get(a))) {
    const shard = shards.reduce((a, b) => (b.ms < a.ms ? b : a));
    shard.files.push(file);
    shard.ms += durations.get(file);
  }
  return shards.filter((s) => s.files.length).map((s) => ({ ...s, files: s.files.sort() }));
}

const files = readdirSync(HERE).filter((f) => f.endsWith(".spec.ts") && statSync(path.join(HERE, f)).isFile());
const shards = assign(files);
rmSync(BLOBS, { recursive: true, force: true });

// The build and the local Postgres start at the same time; each shard's API then only adds its database.
console.log(`Building the web app and starting the local database, then ${shards.length} shards`);
const [built, database] = await Promise.all([
  run("build", "npm", ["run", "build"], { env: { NEXT_DIST_DIR: ".next-e2e" } }),
  run("db", "uv", ["run", "python", "-m", "scripts.local_db", "--database", "fd_e2e_1"], { cwd: BACKEND_DIR }),
]);
if (built !== 0 || database !== 0) {
  console.error(`The ${built !== 0 ? "web build" : "local database"} failed; no tests ran.`);
  process.exit(1);
}
console.log(`Ready after ${seconds()}`);

const codes = await Promise.all(
  shards.map((shard, i) => {
    const n = i + 1;
    console.log(`[${n}] ${shard.files.join(" ")} (about ${Math.round(shard.ms / 1000)} s last time)`);
    return run(String(n), "npx", ["playwright", "test", ...shard.files.map((f) => `e2e/${f}`)], {
      env: {
        E2E_SHARD: String(n),
        E2E_PREBUILT: "1",
        E2E_DATABASE: `fd_e2e_${n}`,
        E2E_API_PORT: `87${n}2`,
        E2E_WEB_PORT: `37${n}0`,
        E2E_CONTROL_PORT: `87${n}9`,
      },
    });
  }),
);

console.log(`Shards finished after ${seconds()}; merging their reports`);
for (let n = 1; n <= shards.length; n++) {
  const blob = path.join(BLOBS, `shard-${n}`, `shard-${n}.zip`);
  if (existsSync(blob)) renameSync(blob, path.join(BLOBS, `shard-${n}.zip`));
}
const merged = await run("merge", "npx", ["playwright", "merge-reports", "--reporter", "json,html", "blob-report"], {
  env: { PLAYWRIGHT_JSON_OUTPUT_NAME: "e2e-results.json" },
});
const failed = codes.map((c, i) => (c ? i + 1 : 0)).filter(Boolean);
console.log(failed.length ? `Shards with failures: ${failed.join(", ")}` : "Every shard passed", `(${seconds()} in all)`);
process.exit(failed.length || merged ? 1 : 0);
