import { expect, resetDatabase, test } from "./fixtures";
import { postJson, raiseBug } from "./helpers";
import type { Page } from "@playwright/test";

// Manual checklist section 9: Staff: reply and reopen.

test.beforeAll(resetDatabase);

/** Liam raises a plain bug about RAKE Agent (Darlene's) and Marc approves it, so Darlene holds it. */
async function approvedBug(liam: Page, marc: Page, title: string) {
  const ref = await raiseBug(liam, "rake-agent", title);
  await postJson(marc, `/console/items/${ref}/approve`);
  return ref;
}

/** Open the tracker's full history if it is folded, so any entry can be read. */
async function expandHistory(page: Page) {
  const more = page.getByRole("button", { name: /See full history/ });
  if (await more.count()) await more.click();
  return page.getByRole("region", { name: "Tracking history" });
}

async function reply(page: Page, text: string) {
  await page.getByLabel("Reply or add details").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("S09.01 A reply on an open item toasts 'Added. The owner has been told.' and history shows 'You added details'", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent fails on my phone");

  await page.goto(`/track/${ref}`);
  await expect(page.getByText("The owner is notified straight away.")).toBeVisible();
  await reply(page, "It also fails on my phone");

  await expect(page.getByText("Added. The owner has been told.")).toBeVisible();
  await expect(page.getByLabel("Reply or add details")).toHaveValue("");
  const history = page.getByRole("region", { name: "Tracking history" });
  await expect(history.getByRole("listitem").first()).toContainText("You added details");
  await expect(history.getByRole("listitem").first()).toContainText("It also fails on my phone");
});

test("S09.02 Darlene sees New reply on the card and a bell notification that Liam added details", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const darlene = await team.as("Darlene");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent prints blank pages");
  await page.goto(`/track/${ref}`);
  await reply(page, "It happens every time");
  await expect(page.getByText("Added. The owner has been told.")).toBeVisible();

  // New reply is only on the card, so the item panel stays closed. A real <button>
  // is picked because the board's drag wrapper is a second element with role "button".
  await darlene.goto("/console");
  const card = darlene.locator("button", { hasText: ref });
  await expect(card.getByText("New reply", { exact: true })).toBeVisible();

  await darlene.getByRole("button", { name: /^Notifications/ }).click();
  await expect(darlene.getByText(`${ref}: Liam Carter added details`)).toBeVisible();
});

test("S09.03 On a Resolved item the helper says 'Still not right? Replying reopens it.' and a reply returns it to In progress", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const darlene = await team.as("Darlene");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent loses my filters");
  await postJson(darlene, `/console/items/${ref}/start`);
  await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Fix deployed" });

  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");
  await expect(page.getByText("Still not right? Replying reopens it.")).toBeVisible();
  await reply(page, "Still blank on my phone");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Being worked on");
  await expect(page.getByLabel("Progress").getByRole("listitem").filter({ hasText: "In progress" })).toContainText("current stage");
  const history = await expandHistory(page);
  await expect(history).toContainText("Reopened after you added details");
  await expect(history).toContainText("You added details");
});

test("S09.04 A Closed or Declined item has no reply box", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const marc = await team.as("Marc");
  const darlene = await team.as("Darlene");

  const closed = await approvedBug(page, marc, "RAKE Agent should whistle on start-up");
  await postJson(darlene, `/console/items/${closed}/close`, { reason: "Done", ending: "no_longer_needed" });
  await page.goto(`/track/${closed}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No longer needed");
  await expect(page.getByLabel("Reply or add details")).toHaveCount(0);

  const declined = await raiseBug(page, "rake-agent", "RAKE Agent should print on gold paper");
  await postJson(marc, `/console/items/${declined}/decline`, { reason: "Not now" });
  await page.goto(`/track/${declined}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Declined");
  await expect(page.getByLabel("Reply or add details")).toHaveCount(0);
});

test("S09.05 Darlene replying on Liam's tracker is refused with 'Reply from the console instead.'", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent drops my session");

  const darlene = await team.as("Darlene");
  await darlene.goto(`/track/${ref}`);
  await reply(darlene, "Trying to reply from here");

  await expect(darlene.getByRole("alert").filter({ hasText: "Reply from the console instead." })).toBeVisible();
  await expect(darlene.getByText("Added. The owner has been told.")).toHaveCount(0);

  // Nothing was added to Liam's history.
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planned, not started yet");
  await expect(await expandHistory(page)).not.toContainText("Trying to reply from here");
});
