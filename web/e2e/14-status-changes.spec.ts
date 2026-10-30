import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, moveTo, openActivity, postJson, raiseBug, statusMoves } from "./helpers";

// Manual checklist section 14: Digital Staff change an item's status from the console panel.
// Staff raise RAKE Agent, IT Asset, Workflow Atlas, AFSS Portal and Fire Safety Blog Agent bugs (all
// Darlene's); Chris approves; the checks are on Darlene's panel and board and on the submitter's tracker.
// Liam and the other staff stand in for Mario, the person who raised it.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };

/** A calendar date as an ISO string, today (UTC, the day the server counts in) plus `days`. */
const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** "Thu 29 Oct" as the screen writes a calendar date; the comma after the weekday depends on the browser's locale data. */
function dayText(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const part = (options: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-AU", options);
  return new RegExp(`${part({ weekday: "short" })},? ${d.getDate()} ${part({ month: "short" })}`);
}

/** A staff member raises a plain bug about one of Darlene's tools and Chris approves it. */
async function approved(submitter: Page, team: Team, project: string, subject: string) {
  const ref = await raiseBug(submitter, project, `The ${subject} screen shows an error when I open it`);
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  return ref;
}

/** The same, with Darlene having started work on it. */
async function inProgress(submitter: Page, team: Team, project: string, subject: string) {
  const ref = await approved(submitter, team, project, subject);
  await postJson(await team.as("Darlene"), `/console/items/${ref}/start`);
  return ref;
}

/** The item's side panel, opened from the address the way a notification link opens it. */
async function openPanel(page: Page, ref: string) {
  await page.goto(`/console?item=${ref}`);
  const panel = page.getByRole("dialog").filter({ hasText: ref });
  await expect(panel).toBeVisible();
  return panel;
}

/** The Due row's Change link opens the due date dialog (D105); the panel itself is hidden while it is open. */
async function openDueDialog(page: Page, panel: Locator) {
  await panel.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Change the due date", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A day's button on the due date calendar (D79), opening it and moving month by month to the one it is in. */
async function calendarDay(page: Page, dialog: Locator, iso: string) {
  await dialog.locator("#expected-by").click();
  const d = new Date(`${iso}T00:00:00`);
  const month = d.toLocaleDateString("en-AU", { month: "long" });
  const grid = page.getByRole("grid", { name: `${month} ${d.getFullYear()}` });
  const back = d < new Date();
  for (let i = 0; i < 24 && !(await grid.isVisible()); i++) {
    await page.getByRole("button", { name: back ? /previous month/i : /next month/i }).click();
  }
  // Day buttons are labelled "Monday, 26 October 2026" (with "Today, " in front for today).
  return grid.getByRole("button", { name: new RegExp(`, ${d.getDate()} ${month} ${d.getFullYear()}$`) });
}

/** Pick a day on the due date calendar. */
async function pickExpectedBy(page: Page, dialog: Locator, iso: string) {
  await (await calendarDay(page, dialog, iso)).click();
  await expect(page.getByRole("grid")).toHaveCount(0);
}

/** The dialog an action opens over the panel; the panel itself is hidden from the page while it is open. */
const actionDialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });

/** The dialog's own submit button; its corner X is also called "Close", so the name alone is not enough. */
const submit = (dialog: Locator) => dialog.locator('button[type="submit"]');

/** The submitter's tracker, loaded. */
async function openTracker(page: Page, ref: string) {
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const band = (page: Page) => page.getByRole("heading", { level: 1 }).locator("..");
/** The tracker's Conversation: one thread, oldest first (D105). */
const conversation = (page: Page) => page.locator("section#activity");
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });

test("S14.01 Status, then Start work, on an Approved item gives In progress in one click, the tracker updates and the submitter is notified", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approved(page, team, "rake-agent", "RAKE Agent weekly summary");

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  await expect(panel.locator("header").getByText("Approved", { exact: true })).toBeVisible();
  await moveTo(darlene, panel, "Start work");
  await expect(panel.locator("header").getByText("In progress", { exact: true })).toBeVisible();
  // The menu now offers only the moves from In progress (D91).
  expect(await statusMoves(darlene, panel)).toEqual(["Resolve…", "Close…"]);

  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Being worked on");
  const current = page.getByRole("region", { name: "Progress" }).getByRole("listitem").filter({ hasText: "In progress" });
  await expect(current).toContainText("current stage");
  await expect(conversation(page)).toContainText("Darlene started work");

  await bell(page).click();
  await expect(page.getByRole("link", { name: new RegExp(`${ref} is being worked on`) })).toBeVisible();
});

test("S14.02 Changing the due date with a note shows both on the tracker and notifies the submitter", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const ref = await inProgress(page, team, "it-asset", "IT Asset barcode scanner");
  const update = "Waiting on the vendor for a patch";
  const expectedBy = isoDay(7);

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  const dialog = await openDueDialog(darlene, panel);
  await dialog.getByLabel("Note for them (optional)").fill(update);
  await pickExpectedBy(darlene, dialog, expectedBy);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(expectedBy));
  await expect(band(page)).toContainText("Expected by");
  const note = conversation(page).getByRole("listitem").filter({ hasText: update });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("Darlene");
  await expect(conversation(page)).toContainText(new RegExp(`Expected by ${dayText(expectedBy).source}`));

  await bell(page).click();
  await expect(page.getByRole("link", { name: new RegExp(`Update on ${ref}, expected by`) })).toBeVisible();
});

test("S14.03 A new due date with no note is accepted; no new date says 'Choose a new due date.'", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const ref = await inProgress(page, team, "workflow-atlas", "Workflow Atlas process map");
  const expectedBy = isoDay(10);

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);

  // No new date: refused on the screen, and by the server for anyone who skips the screen.
  const neither = await openDueDialog(darlene, panel);
  await submit(neither).click();
  await expect(neither.getByRole("alert")).toHaveText("Choose a new due date.");
  await expect(neither).toBeVisible();
  const refused = await darlene.request.post(`/api/console/items/${ref}/update`, { data: { body: "", expected_by: null } });
  expect(refused.ok()).toBe(false);

  // A date and no words.
  await pickExpectedBy(darlene, neither, expectedBy);
  await submit(neither).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(neither).toHaveCount(0);

  // The tracker has the date, and no written message from Darlene.
  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(expectedBy));
  await expect(conversation(page)).toContainText("Expected by");
  await expect(conversation(page).getByRole("listitem").filter({ hasText: "has it" })).toHaveCount(0);
});

test("S14.04 Expected by yesterday: the card says Overdue in red, the column header counts it and the Overdue inbox lists it", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const ref = await inProgress(page, team, "afss-portal", "AFSS Portal booking calendar");
  const yesterday = isoDay(-1);

  // The calendar offers no day already gone, so yesterday is set through the API, after the screen shows it can't be picked.
  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  const dialog = await openDueDialog(darlene, panel);
  await expect(await calendarDay(darlene, dialog, yesterday)).toBeDisabled();
  await darlene.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await postJson(darlene, `/console/items/${ref}/update`, { body: "", expected_by: yesterday, due_reason: "Overdue on purpose" });

  // Board view, Assigned to me: the In progress column.
  await darlene.request.put("/api/console/view", { data: { view: "board" } });
  await darlene.goto("/console");
  const column = darlene.getByRole("region", { name: /^In progress, \d+ items$/ });
  const card = column.locator("button", { hasText: ref });
  await expect(card).toBeVisible();
  await expect(card).toContainText(new RegExp(`Overdue · ${dayText(yesterday).source}`));
  await expect(card.getByText(/^Overdue/)).toHaveClass(/text-destructive/);
  await expect(column.getByText("1 overdue")).toBeVisible();

  await darlene.getByRole("tab", { name: "Overdue" }).click();
  await expect(darlene.getByRole("tab", { name: "Overdue" })).toHaveAttribute("aria-selected", "true");
  await expect(darlene).toHaveURL(/inbox=overdue/);
  await expect(darlene.locator("button", { hasText: ref })).toBeVisible();
});

test("S14.05 Resolve needs a note; with a note it becomes the tracker's last entry, 'Resolved by Darlene' with the note", async ({ page, signIn, team }) => {
  await signIn("Rafael");
  const ref = await inProgress(page, team, "fire-safety-blog-agent", "Fire Safety Blog Agent draft preview");
  const note = "Fixed the preview and released it to production";

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  await moveTo(darlene, panel, "Resolve…");
  const dialog = actionDialog(darlene, "Resolve");

  // No note: refused, and the item is still being worked on.
  await submit(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveText("What was done is needed.");
  await expect(dialog).toBeVisible();
  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Being worked on");

  // With a note: resolved.
  await dialog.getByLabel("What was done").fill(note);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(panel.locator("header").getByText("Resolved", { exact: true })).toBeVisible();

  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");
  await expect(conversation(page)).toContainText("Resolved by Darlene");
  await expect(conversation(page).getByRole("listitem").last()).toContainText(`Resolved by Darlene: ${note}`);
});

test("S14.06 Close asks how it ends and shows the reason on the tracker; Won't fix without a reason is refused", async ({ page, signIn, team }) => {
  await signIn("Mei");
  const reason = "Confirmed working after the weekend release";
  const closing = await inProgress(page, team, "rake-agent", "RAKE Agent citation list");
  const darlene = await team.as("Darlene");

  // No longer needed, with a reason.
  const panel = await openPanel(darlene, closing);
  await moveTo(darlene, panel, "Close…");
  const dialog = actionDialog(darlene, "Close");
  await dialog.getByRole("radio", { name: /No longer needed/ }).check();
  await dialog.getByLabel("Reason (shown to staff)").fill(reason);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await openTracker(page, closing);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No longer needed");
  await expect(page.getByText(`Reason: ${reason}`)).toBeVisible();

  // Another item: submitting without choosing how it ends is refused, then Won't fix with the reason left empty.
  const liam = await team.as("Liam");
  const declining = await approved(liam, team, "it-asset", "IT Asset licence register");
  const second = await openPanel(darlene, declining);
  await moveTo(darlene, second, "Close…");
  const wontFix = actionDialog(darlene, "Close");
  await submit(wontFix).click();
  await expect(wontFix.getByRole("alert")).toHaveText("Choose how it ends.");
  await wontFix.getByRole("radio", { name: /Won't fix/ }).check();
  await submit(wontFix).click();
  await expect(wontFix.getByRole("alert")).toHaveText("Reason (shown to staff) is needed.");
  await expect(wontFix).toBeVisible();
  const refused = await darlene.request.post(`/api/console/items/${declining}/close`, { data: { reason: "", ending: "wont_fix" } });
  expect(refused.ok()).toBe(false);
  await openTracker(liam, declining);
  await expect(liam.getByRole("heading", { level: 1 })).toHaveText("Planned, not started yet");

  // With a reason it goes through, and the tracker shows it.
  await wontFix.getByLabel("Reason (shown to staff)").fill("Duplicate of the register rebuild");
  await submit(wontFix).click();
  await expect(wontFix).toHaveCount(0);
  await openTracker(liam, declining);
  await expect(liam.getByRole("heading", { level: 1 })).toHaveText("Won't fix");
  await expect(liam.getByText("Reason: Duplicate of the register rebuild")).toBeVisible();
});

test("S14.08 On a Resolved item Darlene's Status menu has no Close; as Chris, Close as fixed asks for a reason only the team sees, and the tracker ends on Fixed", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const ref = await inProgress(page, team, "rake-agent", "RAKE Agent glossary");
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Glossary entries restored" });

  // The person who raised it closes it, or the clock does (D92): the holder can only start it again.
  const held = await openPanel(darlene, ref);
  expect(await statusMoves(darlene, held)).toEqual(["Start work again"]);
  const refused = await darlene.request.post(`/api/console/items/${ref}/close`, { data: { reason: "Works", ending: "fixed" } });
  expect(refused.status()).toBe(409);

  const chris = await team.as("Chris");
  const panel = await openPanel(chris, ref);
  await moveTo(chris, panel, "Close as fixed…");
  const dialog = actionDialog(chris, "Close as fixed");
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await submit(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveText("Reason (only the Digital team sees it) is needed.");
  await dialog.getByLabel("Reason (only the Digital team sees it)").fill("Tom confirmed it on the phone");
  await submit(dialog).click();
  await expect(chris.getByText("Saved", { exact: true })).toBeVisible();
  await expect(panel.locator("header").getByText("Fixed", { exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "Conversation" }).click();
  await expect(panel.getByRole("tabpanel")).toContainText("Chris · Closed as fixed for them: Tom confirmed it on the phone");

  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixed");
  await expect(page.getByText("Reason:")).toHaveCount(0);
  await expect(page.getByText("Tom confirmed it on the phone")).toHaveCount(0);
  await expect(conversation(page).getByRole("listitem").last()).toContainText("Closed as fixed by Chris");
  const last = page.getByRole("region", { name: "Progress" }).getByRole("listitem").filter({ hasText: "Fixed" });
  await expect(last).toContainText("current stage");
});

test("S14.07 The dashboard's Median time to first response changes after the first update on a new item", async ({ page, signIn, team }) => {
  // Any earlier first response (an approval counts as one) would already be in the median, so this
  // test starts from the empty seed; the file's other tests raise their own items and do not mind.
  test.setTimeout(90_000);
  resetDatabase();

  await signIn("Aisha");
  const ref = await raiseBug(page, "afss-portal", "The AFSS Portal invoice download screen shows an error when I open it");

  // The dashboard is for Admins (D112); Darlene, who holds the item, gives the first response.
  const chris = await team.as("Chris");
  const median = chris.getByText("Median time to first response", { exact: true }).locator("xpath=following-sibling::p[1]");
  await chris.goto("/console/dashboard");
  await expect(median).toHaveText("–");

  // The first update on the item, before anyone has approved it, is the first response.
  await postJson(await team.as("Darlene"), `/console/items/${ref}/update`, { body: "Looking into the invoice download now" });
  await chris.reload();
  await expect(median).toHaveText(/^\d+(\.\d+)? h$/);
});

test("S14.09 Change the due date says what the date is for and picks it on a calendar in the app's date style, with no Ask them to check it; Resolve shows an example", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await inProgress(await team.as("Liam"), team, "rake-agent", "RAKE Agent training calendar");
  const panel = await openPanel(page, ref);
  const update = await openDueDialog(page, panel);
  await expect(update).toContainText("They see it as Expected by");
  await expect(update.locator("#expected-by")).toHaveText("Pick a date");
  await update.locator("#expected-by").click();
  await page.getByRole("grid").locator("button:not([disabled])").last().click();
  const picked = update.locator("#expected-by");
  await expect(picked).toHaveText(/^[A-Z][a-z]{2},? \d{1,2} [A-Z][a-z]{2}$/);
  await expect(picked).not.toHaveText(/\d+\/\d+\/\d{4}/);
  await expect(update.getByRole("checkbox")).toHaveCount(0);
  await update.getByRole("button", { name: "Cancel" }).click();

  await moveTo(page, panel, "Resolve…");
  const resolve = actionDialog(page, "Resolve");
  await expect(resolve.getByRole("textbox")).toHaveAttribute("placeholder", /Please try it and tell us if it still happens/);
});

test("S14.10 Moving the due date after approval asks why, for the Digital team only; Chris, who approved it, is told", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const ref = await raiseBug(page, "workflow-atlas", "The Workflow Atlas export screen shows an error when I open it");
  const [first, later] = [isoDay(5), isoDay(12)];
  const reason = "Waiting on the vendor's index fix";
  const chris = await team.as("Chris");
  await postJson(chris, `/console/items/${ref}/approve`, { due_date: first });

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  const dialog = await openDueDialog(darlene, panel);
  await expect(dialog).toContainText("Now due");
  await pickExpectedBy(darlene, dialog, later);
  const why = dialog.getByRole("textbox", { name: "Why the date moved (only the Digital team sees it)" });
  await expect(why).toBeVisible();
  await submit(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveText("Say why the due date moved.");
  await why.fill(reason);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await openActivity(panel);
  await expect(panel.getByRole("tabpanel")).toContainText(`: ${reason}`);

  const told = (await getJson<{ items: { title: string; body: string }[] }>(chris, "/notifications")).items.find((n) => n.title.startsWith(`${ref}: due date moved from`));
  expect(told?.body).toBe(`Darlene: ${reason}`);

  // Tom sees the new date, never the reason.
  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(later));
  await expect(page.getByRole("main")).not.toContainText("vendor");
});
