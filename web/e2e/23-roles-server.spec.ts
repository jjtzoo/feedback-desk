import { expect, resetDatabase, test } from "./fixtures";
import { postJson, raiseBug } from "./helpers";

// Manual checklist section 23: roles enforced on the server. Opening an /api/... address in the address bar
// (a document navigation, which page.goto is) must show a refusal page or the sign-in page, never raw JSON.

test.beforeAll(resetDatabase);

test("S23.01 Signed out, opening /api/my/feedback sends you to the sign-in page with no data", async ({ page, team }) => {
  // Someone has feedback on file, so "no data" is read against something that could have leaked.
  const title = "RAKE Agent crashes when I open the signed-out address";
  await raiseBug(await team.as("Liam"), "rake-agent", title);

  // This page has no sign-in cookie.
  await page.goto("/api/my/feedback");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/sign-in");
  expect(url.searchParams.get("next")).toBe("/api/my/feedback");

  const main = page.getByRole("main");
  await expect(main).not.toContainText(title);
  await expect(main).not.toContainText(/FB-\d{4}/);
});

test("S23.02 As Darlene, opening /api/console/approvals shows the You can't open that page", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  // An item is waiting for approval, so the Admin-only list has something to leak.
  const title = "RAKE Agent crashes when I open the approvals address";
  await raiseBug(await team.as("Liam"), "rake-agent", title);

  await page.goto("/api/console/approvals");
  await expect(page.getByRole("heading", { name: "You can't open that" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Smoke Signal" })).toHaveAttribute("href", "/");

  const main = page.getByRole("main");
  await expect(main).not.toContainText(title);
  await expect(main).not.toContainText(/FB-\d{4}/);
  await expect(main).not.toContainText(/[{}]/);
});

test("S23.03 Staff opening /api/console/board and /api/admin/projects get the You can't open that page for both", async ({ page, signIn }) => {
  await signIn("Liam");

  await page.goto("/api/console/board");
  await expect(page.getByRole("heading", { name: "You can't open that" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Smoke Signal" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/[{}]/);

  await page.goto("/api/admin/projects");
  await expect(page.getByRole("heading", { name: "You can't open that" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Smoke Signal" })).toBeVisible();
  // No project names from the Admin list on the refusal page.
  await expect(page.getByRole("main")).not.toContainText("RAKE Agent");
  await expect(page.getByRole("main")).not.toContainText(/[{}]/);
});

test("S23.04 Staff opening /console/channels/rake-agent see the console is for the Digital team, with no channel content", async ({ page, signIn, team }) => {
  // A message is in the channel, so "no channel content" is read against something that could have leaked.
  const note = "Channel only note: the RAKE Agent cache is rebuilt nightly";
  await postJson(await team.as("Darlene"), "/console/channels/rake-agent", { body: note });

  await signIn("Liam");
  // The channel page would ask the API for its messages; the refusal page must never get that far.
  const channelCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/console/channels/")) channelCalls.push(r.url());
  });

  await page.goto("/console/channels/rake-agent");
  await expect(page.getByRole("heading", { name: "The console is for the Digital team" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Give feedback" })).toBeVisible();

  await expect(page.getByText(note)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /# RAKE Agent/ })).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Console" })).toHaveCount(0);
  expect(channelCalls).toEqual([]);
});
