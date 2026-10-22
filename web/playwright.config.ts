import { defineConfig, devices } from "@playwright/test";

import { API, TOUR_SEEN, WEB } from "./e2e/env";

/**
 * Browser tests for the staff area and the console, against a throwaway API and database:
 * its own ports (API 8002, web 3100), its own database (fd_e2e, recreated on start and reset
 * before each spec file), the scripted stub model, no email. Rules: e2e/CLAUDE.md.
 *
 *   npm run test:e2e                  build, start both servers, run everything
 *   npm run test:e2e -- e2e/<file>    one file
 *   npm run test:e2e:coverage         checklist coverage -> e2e/COVERAGE.md
 *
 * E2E_REUSE=1 reuses servers you already started (faster while writing tests).
 */
export default defineConfig({
  testDir: "./e2e",
  // One shared database, so the specs run in order in one worker.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results.json" }]],
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
      command: "npm run build && npm run start -- --port 3100",
      url: WEB,
      timeout: 360_000,
      reuseExistingServer: Boolean(process.env.E2E_REUSE),
      env: { NEXT_DIST_DIR: ".next-e2e", API_ORIGIN: API },
    },
  ],
});
