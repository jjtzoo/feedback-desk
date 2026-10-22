import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test as base, type Page } from "@playwright/test";

import { otherWindow, signInAs, type Person } from "./helpers";

/**
 * backend/scripts/e2e_reset.py with these arguments, on the test database. Run without a shell, so
 * the time limit ends `uv` itself (through cmd.exe it ended only the shell, S11.01); a failure says
 * how long it ran and what the script printed.
 */
function e2eReset(...args: string[]) {
  const started = Date.now();
  try {
    execFileSync("uv", ["run", "python", "-m", "scripts.e2e_reset", ...args], {
      cwd: path.join(__dirname, "..", "..", "backend"),
      stdio: "pipe",
      timeout: 60_000,
    });
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
