import { execFileSync } from "node:child_process";

import { expect, test as base, type Page } from "@playwright/test";

import { API_CONTROL } from "./env";
import { otherWindow, signInAs, type Person } from "./helpers";

/**
 * backend/scripts/e2e_reset.py with these arguments, run by the test API's supervisor (POST /reset),
 * which is already started and connected to the test database. The fixtures stay synchronous, so the
 * request goes through a short-lived node process; a failure says how long it ran and why.
 */
function e2eReset(...args: string[]) {
  const started = Date.now();
  const post = `fetch(${JSON.stringify(`${API_CONTROL}/reset`)}, { method: "POST", body: ${JSON.stringify(JSON.stringify({ args }))} })
    .then(async (r) => { if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); } })
    .catch((e) => { console.error(String(e)); process.exit(1); });`;
  try {
    execFileSync(process.execPath, ["-e", post], { stdio: "pipe", timeout: 60_000 });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim().slice(-2000);
    throw new Error(`e2e_reset ${args.join(" ")} failed after ${Date.now() - started} ms: ${e}\n${stderr ?? ""}`);
  }
}

/**
 * Put the database back to the seed (no feedback, references from FB-0001). Every spec file
 * starts with `test.beforeAll(resetDatabase)` as its first line, so files never depend on each other.
 * Sign-in sessions survive, so `team` windows stay signed in.
 */
export function resetDatabase() {
  e2eReset();
}

/**
 * Record chat model usage the stub model never records: a person's tokens today (`email`), or
 * spend toward the budgets (no email), today or (`monthStart`) earlier this month.
 */
export function addUsage({ email, tokens = 0, cost = 0, monthStart = false }: { email?: string; tokens?: number; cost?: number; monthStart?: boolean }) {
  e2eReset("usage", ...(email ? ["--email", email] : []), "--tokens", String(tokens), "--cost", String(cost), ...(monthStart ? ["--month-start"] : []));
}

/** Remove the usage `addUsage` recorded. */
export function clearUsage() {
  e2eReset("usage", "--clear");
}

/** Other people, each in their own signed-in window: "as Darlene, in a private window". */
class Team {
  private windows = new Map<string, Awaited<ReturnType<typeof otherWindow>>>();

  constructor(private browser: Parameters<typeof otherWindow>[0]) {}

  /** The window for this person, opened and signed in on first use, then reused. */
  async as(first: string): Promise<Page> {
    let w = this.windows.get(first);
    if (!w) {
      w = await otherWindow(this.browser, first);
      this.windows.set(first, w);
    }
    return w.page;
  }

  async closeAll() {
    await Promise.all([...this.windows.values()].map((w) => w.close()));
    this.windows.clear();
  }
}

type TestFixtures = {
  /** Sign the test's own page in as a seeded person, by first name (Liam, Mario, Darlene, Chris, …). */
  signIn: (first: string) => Promise<Person>;
};

type WorkerFixtures = {
  /** Second and third people for two-person tests; windows live for the whole worker. */
  team: Team;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  signIn: async ({ page }, use) => {
    await use((first) => signInAs(page, first));
  },
  team: [
    async ({ browser }, use) => {
      const team = new Team(browser);
      await use(team);
      await team.closeAll();
    },
    { scope: "worker" },
  ],
});

export { expect };
