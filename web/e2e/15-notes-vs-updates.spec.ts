import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, openActivity, postJson, raiseBug, trackerConversation } from "./helpers";

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

/** The console panel for an item, open on its Conversation (D105). */
async function openPanel(page: Page, ref: string) {
  await page.goto(`/console?item=${ref}`);
  await openActivity(page.getByRole("dialog"));
}

const NOTE_BOX = "Internal note (staff never see it)";

async function openTracker(page: Page, ref: string) {
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Open the bell on a staff page and wait for its list, so what is not in it is read from a loaded list. */
async function openBell(page: Page) {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog").getByText("Notifications", { exact: true })).toBeVisible();
}

test("S15.01 An internal note shows 'Internal note added' with a lock, is not on the submitter's tracker, and sends no notification to them", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const note = "Internal only: the cache key is wrong, check with Marc before replying";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I rename a saved search");
  const before = await bellTitles(page);

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  // The composer starts on Internal note (D96).
  await expect(darlene.getByRole("radio", { name: "Internal note" })).toBeChecked();
  await darlene.getByRole("textbox", { name: NOTE_BOX }).fill(note);
  await darlene.getByRole("button", { name: "Add internal note" }).click();

  await expect(darlene.getByText("Internal note added", { exact: true })).toBeVisible();
  const entry = darlene.getByRole("dialog").getByRole("listitem").filter({ hasText: note });
  await expect(entry).toContainText("Internal");
  await expect(entry).toContainText("Darlene");

  // The submitter's tracker has no trace of it.
  await openTracker(page, ref);
  await expect(page.locator("body")).not.toContainText("cache key is wrong");
  await expect(trackerConversation(page)).not.toContainText("Internal only");

  // And the bell holds nothing new.
  await openBell(page);
  await expect(page.getByRole("dialog")).not.toContainText("cache key is wrong");
  expect(await bellTitles(page)).toEqual(before);
});

test("S15.02 Replying to Aisha puts Darlene's words in the tracker's Conversation under her name with 'has it', and notifies the submitter", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const reply = "We have reproduced it and a fix is being tested";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I export a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  await darlene.getByRole("radio", { name: "Reply to Aisha" }).click();
  await darlene.getByRole("textbox", { name: "Message to Aisha (they'll see it)" }).fill(reply);
  await darlene.getByRole("button", { name: "Send to Aisha" }).click();
  await expect(darlene.getByText("Sent to Aisha", { exact: true })).toBeVisible();
  // The new entry is marked, not just appended to the thread.
  await expect(darlene.getByText("Sent just now")).toBeVisible();

  await openTracker(page, ref);
  const entry = trackerConversation(page).getByRole("listitem").filter({ hasText: reply });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(/Darlene\s*has it/);

  await openBell(page);
  await expect(page.getByRole("dialog").getByText(`Darlene replied on ${ref}`)).toBeVisible();
});

test("S15.03 Changing the due date with a note shows Expected by on the tracker and the note in the Conversation under Darlene, once", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const note = "Found the cause and a fix goes out on Thursday";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I share a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  await darlene.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = darlene.getByRole("dialog", { name: "Change the due date" });
  await dialog.locator("#expected-by").click();
  await darlene.getByRole("grid").locator("button:not([disabled])").last().click();
  await dialog.getByRole("textbox", { name: "Note for them (optional)" }).fill(note);
  await dialog.getByRole("button", { name: "Save due date", exact: true }).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();

  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Expected by");
  const entry = trackerConversation(page).getByRole("listitem").filter({ hasText: note });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(/Darlene\s*has it/);
});

test("S15.04 A question for the owner written as an internal note stays inside the team: staff never see it", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const question = "Is this the same cache fault as last month";
  // Not approved: the note is for an item still waiting for a decision.
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I delete a saved search");
  const before = await bellTitles(page);

  const chris = await team.as("Chris");
  await openPanel(chris, ref);
  await chris.getByRole("textbox", { name: NOTE_BOX }).fill(question);
  await chris.getByRole("button", { name: "Add internal note" }).click();
  await expect(chris.getByText("Internal note added", { exact: true })).toBeVisible();

  const entry = chris.getByRole("dialog").getByRole("listitem").filter({ hasText: question });
  await expect(entry).toContainText("Internal");
  await expect(entry).toContainText("Chris");

  // The submitter's tracker and bell show nothing of it.
  await openTracker(page, ref);
  await expect(page.locator("body")).not.toContainText("same cache fault");
  await expect(trackerConversation(page)).not.toContainText(/question|asked/i);
  await openBell(page);
  await expect(page.getByRole("dialog")).not.toContainText("same cache fault");
  expect(await bellTitles(page)).toEqual(before);
});

test("S15.05 Reply to Aisha and Internal note are two sides of one box in one Conversation: Internal note first, back to it after each reply, and only the note has a lock", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const ref = await approvedBug(page, team, "RAKE Agent loses my filters after a search");
  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  const panel = darlene.getByRole("dialog");

  // Internal note side: its own box and button, nothing that goes to Aisha.
  await expect(panel.getByRole("radio", { name: "Internal note" })).toBeChecked();
  await expect(panel.getByRole("textbox", { name: "Message to Aisha (they'll see it)" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send to Aisha" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: NOTE_BOX }).fill("Probably the session cache again");
  await panel.getByRole("button", { name: "Add internal note" }).click();
  await expect(darlene.getByText("Internal note added", { exact: true })).toBeVisible();

  // Reply side: its own box and button; it falls back to Internal note after sending (D96).
  await panel.getByRole("radio", { name: "Reply to Aisha" }).click();
  await expect(panel.getByRole("textbox", { name: NOTE_BOX })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Add internal note" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: "Message to Aisha (they'll see it)" }).fill("Which filters did you have on?");
  await panel.getByRole("button", { name: "Send to Aisha" }).click();
  await expect(darlene.getByText("Sent to Aisha", { exact: true })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Internal note" })).toBeChecked();

  // Both are in the one thread, oldest first; only the note carries the lock.
  const items = panel.getByRole("listitem");
  const note = items.filter({ hasText: "Probably the session cache again" });
  const message = items.filter({ hasText: "Which filters did you have on?" });
  await expect(note).toContainText("Internal");
  await expect(message).not.toContainText("Internal");
  const texts = await items.allInnerTexts();
  expect(texts.findIndex((t) => t.includes("session cache"))).toBeLessThan(texts.findIndex((t) => t.includes("Which filters")));
});
