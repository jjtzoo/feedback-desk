import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, postJson, raiseBug } from "./helpers";

// Manual checklist section 15 (Digital Staff: internal notes vs public updates). The person giving
// feedback is a seeded staff member (the checklist says Mario, who is Digital Staff), so "his tracker"
// is that person's /track page. Items are raised and approved through the API; the writing is done
// in the console panel, and the results are read on the tracker and in the bell.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };

/** The staff member raises a plain RAKE Agent bug (Darlene's) and Marc approves it, so Darlene can work it. */
async function approvedBug(staff: Page, team: Team, title: string) {
  const ref = await raiseBug(staff, "rake-agent", title);
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  return ref;
}

/** What the bell lists for this person: the titles, newest first. */
async function bellTitles(page: Page) {
  return (await getJson<{ items: { title: string }[] }>(page, "/notifications")).items.map((n) => n.title);
}

/** The console panel for an item, open on the tab asked for. */
async function openPanel(page: Page, ref: string, tab: RegExp) {
  await page.goto(`/console?item=${ref}`);
  await page.getByRole("tab", { name: tab }).click();
}

const historyOf = (page: Page) => page.getByRole("region", { name: "Tracking history" });

async function openTracker(page: Page, ref: string) {
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Open the bell on a staff page and wait for its list, so what is not in it is read from a loaded list. */
async function openBell(page: Page) {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog").getByText("Notifications", { exact: true })).toBeVisible();
}

test("S15.01 An internal note shows 'Note added' and is not on the submitter's tracker, with no notification to them", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const note = "Internal only: the cache key is wrong, check with Marc before replying";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I rename a saved search");
  const before = await bellTitles(page);

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref, /^Conversation/);
  await darlene.getByRole("button", { name: "Internal note", exact: true }).click();
  await darlene.getByRole("textbox", { name: "Internal note (staff never see it)" }).fill(note);
  await darlene.getByRole("button", { name: "Add note" }).click();

  await expect(darlene.getByText("Note added")).toBeVisible();
  const entry = darlene.getByRole("listitem").filter({ hasText: note });
  await expect(entry).toContainText("Internal note");
  await expect(entry).toContainText("Darlene");

  // The submitter's tracker has no trace of it, in the history or as a latest update.
  await openTracker(page, ref);
  await expect(page.getByRole("region", { name: "Latest update" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("cache key is wrong");
  await expect(historyOf(page)).not.toContainText("Internal only");

  // And the bell holds nothing new.
  await openBell(page);
  await expect(page.getByRole("dialog")).not.toContainText("cache key is wrong");
  expect(await bellTitles(page)).toEqual(before);
});

test("S15.02 'Reply to submitter' shows 'Reply from Darlene' on the tracker and in Latest update, and notifies the submitter", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const reply = "We have reproduced it and a fix is being tested";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I export a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref, /^Conversation/);
  await darlene.getByRole("button", { name: "Reply to submitter", exact: true }).click();
  await darlene.getByRole("textbox", { name: "Reply to the submitter" }).fill(reply);
  await darlene.getByRole("button", { name: "Send reply" }).click();
  await expect(darlene.getByText("Reply sent to the submitter")).toBeVisible();

  await openTracker(page, ref);
  const latest = page.getByRole("region", { name: "Latest update" });
  await expect(latest).toContainText(reply);
  await expect(latest).toContainText("Darlene");
  await expect(historyOf(page).getByRole("listitem").first()).toContainText("Reply from Darlene");
  await expect(historyOf(page).getByRole("listitem").first()).toContainText(reply);

  await openBell(page);
  await expect(page.getByRole("dialog").getByText(`Darlene replied on ${ref}`)).toBeVisible();
});

test("S15.03 A progress update shows as 'Update: …' on the tracker", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const update = "Found the cause and a fix goes out on Thursday";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I share a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref, /^Brief/);
  await darlene.getByRole("button", { name: "Post update", exact: true }).click();
  const dialog = darlene.getByRole("dialog", { name: "Post a progress update" });
  await dialog.getByRole("textbox", { name: "Update", exact: true }).fill(update);
  await dialog.getByRole("button", { name: "Post update", exact: true }).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();

  await openTracker(page, ref);
  await expect(historyOf(page).getByRole("listitem").first()).toContainText(`Update: ${update}`);
  await expect(page.getByRole("region", { name: "Latest update" })).toContainText(update);
});

test("S15.04 Ask for info to 'The owner (internal)' becomes an internal note that staff never see", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const question = "Is this the same cache fault as last month";
  // Not approved: Ask for info is for an item still waiting for a decision.
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I delete a saved search");
  const before = await bellTitles(page);

  const chris = await team.as("Chris");
  await openPanel(chris, ref, /^Brief/);
  await chris.getByRole("button", { name: "Ask for info", exact: true }).click();
  const dialog = chris.getByRole("dialog", { name: "Ask for more information" });
  await dialog.getByRole("radio", { name: "The owner (internal)" }).check();
  await dialog.getByRole("textbox", { name: "Question" }).fill(question);
  await dialog.getByRole("button", { name: "Send question" }).click();
  await expect(chris.getByText("Saved", { exact: true })).toBeVisible();

  // It landed in the conversation as an internal note, not as a reply.
  await chris.getByRole("tab", { name: /^Conversation/ }).click();
  const entry = chris.getByRole("listitem").filter({ hasText: question });
  await expect(entry).toContainText("Internal note");
  await expect(entry).toContainText(`Question for the owner: ${question}`);
  await expect(entry).not.toContainText("Reply");

  // The submitter's tracker and bell show nothing of it.
  await openTracker(page, ref);
  await expect(page.getByRole("region", { name: "Latest update" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("same cache fault");
  await expect(historyOf(page)).not.toContainText(/question|asked/i);
  await openBell(page);
  await expect(page.getByRole("dialog")).not.toContainText("same cache fault");
  expect(await bellTitles(page)).toEqual(before);
});
