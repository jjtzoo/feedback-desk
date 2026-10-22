import { expect, resetDatabase, test } from "./fixtures";
import { getJson, raiseBug } from "./helpers";

// Checks on the test setup itself, not on a checklist item: the stub model, the reset,
// sign-in, and a second person's window.

test.beforeAll(resetDatabase);

test("setup: the API runs the scripted stub model", async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  expect(health.model.provider).toBe("stub");
});

test("setup: signIn signs the test's page in, with the tour already dismissed", async ({ page, signIn }) => {
  await signIn("Liam");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account: Liam Carter" })).toBeVisible();
  await expect(page.getByText("Welcome to Smoke Signal")).toHaveCount(0);
});

test("setup: team opens a second person's window that stays signed in", async ({ team }) => {
  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await expect(darlene.getByRole("heading", { name: "Work" })).toBeVisible();
  expect(await team.as("Darlene")).toBe(darlene);
});

test("setup: resetDatabase removes feedback and restarts references at FB-0001", async ({ page, signIn, team }) => {
  await signIn("Liam");
  await raiseBug(page, "rake-agent");
  resetDatabase();
  expect(await getJson<unknown[]>(page, "/my/feedback")).toHaveLength(0);
  expect(await raiseBug(page, "rake-agent")).toBe("FB-0001");
  // Windows opened before the reset are still signed in.
  await getJson(await team.as("Darlene"), "/console/board");
});
