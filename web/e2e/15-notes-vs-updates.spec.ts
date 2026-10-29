import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, openTab, postJson, raiseBug } from "./helpers";

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

/** The console panel for an item, open on one of its conversations (D103). */
async function openPanel(page: Page, ref: string, tab: "With" | "Team" = "With") {
  await page.goto(`/console?item=${ref}`);
  await openTab(page.getByRole("dialog"), tab);
}

/** The tracker's Activity feed (D100). */
const historyOf = (page: Page) => page.getByRole("region", { name: "Activity" });
const NOTE_BOX = "Note to the team (staff never see it)";

async function openTracker(page: Page, ref: string) {
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Open the bell on a staff page and wait for its list, so what is not in it is read from a loaded list. */
async function openBell(page: Page) {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog").getByText("Notifications", { exact: true })).toBeVisible();
}

test("S15.01 A note on the Team tab shows 'Sent to the team' and is not on the submitter's tracker, with no notification to them", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const note = "Internal only: the cache key is wrong, check with Marc before replying";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I rename a saved search");
  const before = await bellTitles(page);

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref, "Team");
  await darlene.getByRole("textbox", { name: NOTE_BOX }).fill(note);
  await darlene.getByRole("button", { name: "Send to the team" }).click();

  await expect(darlene.getByText("Sent to the team", { exact: true })).toBeVisible();
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

test("S15.02 Sending on the With Aisha tab puts Darlene's words first in Activity and in Latest update, and notifies the submitter", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const reply = "We have reproduced it and a fix is being tested";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I export a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  await darlene.getByRole("textbox", { name: "Message to Aisha (they'll see it)" }).fill(reply);
  await darlene.getByRole("button", { name: "Send to Aisha" }).click();
  await expect(darlene.getByText("Sent to Aisha", { exact: true })).toBeVisible();
  // The new entry is marked, not just appended to the feed.
  await expect(darlene.getByText("Sent just now")).toBeVisible();

  await openTracker(page, ref);
  const latest = page.getByRole("region", { name: "Latest update" });
  await expect(latest).toContainText(reply);
  await expect(latest).toContainText("Darlene");
  await expect(historyOf(page).getByRole("listitem").first()).toContainText(/Darlene\s*has it/);
  await expect(historyOf(page).getByRole("listitem").first()).toContainText(reply);

  await openBell(page);
  await expect(page.getByRole("dialog").getByText(`Darlene replied on ${ref}`)).toBeVisible();
});

test("S15.03 A progress update shows in Activity under Darlene, marked Update, with its words once", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const update = "Found the cause and a fix goes out on Thursday";
  const ref = await approvedBug(page, team, "RAKE Agent crashes when I share a saved search");

  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  await darlene.getByRole("button", { name: /^Update [A-Z][a-z]+$/ }).click();
  const dialog = darlene.getByRole("dialog", { name: /^Update [A-Z][a-z]+ on progress$/ });
  await dialog.getByRole("textbox", { name: "Update", exact: true }).fill(update);
  await dialog.getByRole("button", { name: "Send update", exact: true }).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();

  await openTracker(page, ref);
  const entry = historyOf(page).getByRole("listitem").first();
  await expect(entry).toContainText(/Darlene\s*has it\s*· Update/);
  await expect(entry.getByText(update, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Latest update" })).toContainText(update);
});

test("S15.04 Ask for info to 'The owner (internal)' becomes an internal note that staff never see", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const question = "Is this the same cache fault as last month";
  // Not approved: Ask for info is for an item still waiting for a decision.
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I delete a saved search");
  const before = await bellTitles(page);

  const chris = await team.as("Chris");
  await openPanel(chris, ref);
  await chris.getByRole("button", { name: "Ask for info", exact: true }).click();
  const dialog = chris.getByRole("dialog", { name: "Ask for more information" });
  await dialog.getByRole("radio", { name: "The owner (internal)" }).check();
  await dialog.getByRole("textbox", { name: "Question" }).fill(question);
  await dialog.getByRole("button", { name: "Send question" }).click();
  await expect(chris.getByText("Saved", { exact: true })).toBeVisible();

  // It landed on the Team tab as an internal note, not as a reply.
  await openTab(chris.getByRole("dialog"), "Team");
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

test("S15.05 With Aisha and Team are separate tabs, each with its own box and send button, and each shows only its own messages", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const ref = await approvedBug(page, team, "RAKE Agent loses my filters after a search");
  const darlene = await team.as("Darlene");
  await openPanel(darlene, ref);
  const panel = darlene.getByRole("dialog");

  // With Aisha: only the message box to her, with its own button.
  await expect(panel.getByRole("textbox", { name: NOTE_BOX })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send to the team" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: "Message to Aisha (they'll see it)" }).fill("Which filters did you have on?");
  await panel.getByRole("button", { name: "Send to Aisha" }).click();
  await expect(darlene.getByText("Sent to Aisha", { exact: true })).toBeVisible();
  const withAisha = panel.getByRole("tabpanel");
  await expect(withAisha).toContainText("Which filters did you have on?");

  // Team: only the note box, with its own button.
  await openTab(panel, "Team");
  await expect(panel.getByRole("textbox", { name: "Message to Aisha (they'll see it)" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Send to Aisha" })).toHaveCount(0);
  await panel.getByRole("textbox", { name: NOTE_BOX }).fill("Probably the session cache again");
  await panel.getByRole("button", { name: "Send to the team" }).click();
  await expect(darlene.getByText("Sent to the team", { exact: true })).toBeVisible();
  const internal = panel.getByRole("tabpanel");
  await expect(internal).toContainText("Probably the session cache again");
  await expect(internal).not.toContainText("Which filters");

  await openTab(panel, "With");
  await expect(panel.getByRole("tabpanel")).not.toContainText("session cache");
});
