import { defineConfig, devices } from "@playwright/test";

import { API, TOUR_SEEN, WEB, WEB_PORT } from "./e2e/env";

const SHARD = process.env.E2E_SHARD;

/**
 * Browser tests for the staff area and the console, against a throwaway API and database:
 * its own ports (API 8002, web 3100; E2E_API_PORT and E2E_WEB_PORT move them), its own database (fd_e2e,
 * or E2E_DATABASE; recreated on start and reset before each spec file), the scripted stub model, no email.
 * Rules: e2e/CLAUDE.md.
 *
 *   npm run test:e2e:full             the whole suite in shards at the same time (e2e/shards.mjs)
 *   npm run test:e2e -- e2e/<file>    one file
 *   npm run test:e2e                  the whole suite in one run (slower)
 *   npm run test:e2e:coverage         checklist coverage -> e2e/COVERAGE.md
 *
 * E2E_REUSE=1 reuses servers you already started (faster while writing tests). E2E_PREBUILT=1 skips
 * the web build (the shard runner builds once for every shard); E2E_SHARD=<n> is set by that runner.
 */
export default defineConfig({
  testDir: "./e2e",
  // One shared database, so the specs run in order in one worker; e2e/shards.mjs runs several of these at once.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // A shard leaves a blob report in its own folder (a blob reporter empties its folder first); the shard
  // runner merges them into the same json and html as one run.
  reporter: SHARD
    ? [["list"], ["blob", { outputDir: `blob-report/shard-${SHARD}`, fileName: `shard-${SHARD}.zip` }]]
    : [["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results.json" }]],
  outputDir: SHARD ? `test-results/shard-${SHARD}` : "test-results",
  use: {
    baseURL: WEB,
    storageState: TOUR_SEEN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run python -m scripts.e2e_server",
      cwd: "../backend",
      url: `${API}/api/health`,
      timeout: 180_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
      env: { E2E_WEB_URL: WEB },
    },
    {
      command: `${process.env.E2E_PREBUILT ? "" : "npm run build && "}npm run start -- --port ${WEB_PORT}`,
      url: WEB,
      timeout: 360_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
      env: { NEXT_DIST_DIR: ".next-e2e", API_ORIGIN: API },
    },
  ],
});
