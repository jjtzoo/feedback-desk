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

/** A button in the panel's header, such as Update <name>; stage moves are in the Status menu (D91). */
const headerButton = (panel: Locator, name: string) => panel.locator("header").getByRole("button", { name, exact: true });

/** The panel's update button and its dialog are named for the person who raised it (D79): "Update Aisha". */
const updateButton = (panel: Locator) => panel.locator("header").getByRole("button", { name: /^Update [A-Z][a-z]+$/ });
const updateDialog = (page: Page) => page.getByRole("dialog", { name: /^Update [A-Z][a-z]+ on progress$/ });

/** Pick a day on the due date calendar (D79), moving month by month to the one it is in. */
async function pickExpectedBy(page: Page, dialog: Locator, iso: string) {
  await dialog.locator("#expected-by").click();
  const d = new Date(`${iso}T00:00:00`);
  const month = d.toLocaleDateString("en-AU", { month: "long" });
  const grid = page.getByRole("grid", { name: `${month} ${d.getFullYear()}` });
  const back = d < new Date();
  for (let i = 0; i < 24 && !(await grid.isVisible()); i++) {
    await page.getByRole("button", { name: back ? /previous month/i : /next month/i }).click();
  }
  // Day buttons are labelled "Monday, 26 October 2026" (with "Today, " in front for today).
  await grid.getByRole("button", { name: new RegExp(`, ${d.getDate()} ${month} ${d.getFullYear()}$`) }).click();
  await expect(grid).toHaveCount(0);
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
const history = (page: Page) => page.getByRole("region", { name: "Tracking history" });
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
  await expect(history(page)).toContainText("Darlene started work");

  await bell(page).click();
  await expect(page.getByRole("link", { name: new RegExp(`${ref} is being worked on`) })).toBeVisible();
});

test("S14.02 Post update with text and a due date shows both on the tracker and notifies the submitter", async ({ page, signIn, team }) => {
  await signIn("Aisha");
  const ref = await inProgress(page, team, "it-asset", "IT Asset barcode scanner");
  const update = "Waiting on the vendor for a patch";
  const expectedBy = isoDay(7);

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  await updateButton(panel).click();
  const dialog = updateDialog(darlene);
  await dialog.getByLabel("Update", { exact: true }).fill(update);
  await pickExpectedBy(darlene, dialog, expectedBy);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(expectedBy));
  await expect(band(page)).toContainText("Expected by");
  await expect(page.getByRole("region", { name: "Latest update" })).toContainText(update);
  await expect(history(page).getByRole("listitem").filter({ hasText: "Update from Darlene" })).toContainText(update);
  await expect(history(page)).toContainText(new RegExp(`Expected by ${dayText(expectedBy).source}`));

  await bell(page).click();
  await expect(page.getByRole("link", { name: new RegExp(`Update on ${ref}, expected by`) })).toBeVisible();
});

test("S14.03 An update with only a date is accepted; one with neither says 'Write an update or set a due date.'", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const ref = await inProgress(page, team, "workflow-atlas", "Workflow Atlas process map");
  const expectedBy = isoDay(10);

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);

  // A date and no words.
  await updateButton(panel).click();
  const dateOnly = updateDialog(darlene);
  await pickExpectedBy(darlene, dateOnly, expectedBy);
  await submit(dateOnly).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dateOnly).toHaveCount(0);

  // Neither: refused on the screen, and by the server for anyone who skips the screen.
  await updateButton(panel).click();
  const neither = updateDialog(darlene);
  await submit(neither).click();
  await expect(neither.getByRole("alert")).toHaveText("Write an update or set a due date.");
  await expect(neither).toBeVisible();
  const refused = await darlene.request.post(`/api/console/items/${ref}/update`, { data: { body: "", expected_by: null } });
  expect(refused.ok()).toBe(false);
  await neither.getByRole("button", { name: "Cancel" }).click();
  await expect(neither).toHaveCount(0);

  // The tracker has the date, and no written update.
  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(expectedBy));
  await expect(history(page)).toContainText("Expected by");
  await expect(history(page)).not.toContainText("Update from");
  await expect(page.getByRole("region", { name: "Latest update" })).toHaveCount(0);
});

test("S14.04 Expected by yesterday: the card says Overdue in red, the column header counts it and the Overdue inbox lists it", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const ref = await inProgress(page, team, "afss-portal", "AFSS Portal booking calendar");
  const yesterday = isoDay(-1);

  const darlene = await team.as("Darlene");
  const panel = await openPanel(darlene, ref);
  await updateButton(panel).click();
  const dialog = updateDialog(darlene);
  await pickExpectedBy(darlene, dialog, yesterday);
  await submit(dialog).click();
  await expect(dialog).toHaveCount(0);

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
  await expect(history(page)).toContainText("Resolved by Darlene");

  await expect(history(page).getByRole("listitem").first()).toContainText(`Resolved by Darlene${note}`);
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
  await panel.getByRole("tab", { name: "Activity" }).click();
  await expect(panel.getByRole("region", { name: "History" })).toContainText("Chris · Closed as fixed for them: Tom confirmed it on the phone");

  await openTracker(page, ref);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixed");
  await expect(page.getByText("Reason:")).toHaveCount(0);
  await expect(page.getByText("Tom confirmed it on the phone")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Tracking history" }).getByRole("listitem").first()).toContainText("Closed as fixed by Chris");
  const last = page.getByRole("region", { name: "Progress" }).getByRole("listitem").filter({ hasText: "Fixed" });
  await expect(last).toContainText("current stage");
});

test("S14.07 The dashboard's Avg time to first response changes after the first update on a new item", async ({ page, signIn, team }) => {
  // Any earlier first response (an approval counts as one) would already be in the average, so this
  // test starts from the empty seed; the file's other tests raise their own items and do not mind.
  test.setTimeout(90_000);
  resetDatabase();

  await signIn("Aisha");
  const ref = await raiseBug(page, "afss-portal", "The AFSS Portal invoice download screen shows an error when I open it");

  const darlene = await team.as("Darlene");
  const average = darlene.getByText("Avg time to first response", { exact: true }).locator("xpath=following-sibling::p[1]");
  await darlene.goto("/console/dashboard");
  await expect(average).toHaveText("–");

  // The first update on the item, before anyone has approved it, is the first response.
  await postJson(darlene, `/console/items/${ref}/update`, { body: "Looking into the invoice download now" });
  await darlene.reload();
  await expect(average).toHaveText(/^\d+(\.\d+)? h$/);
});

test("S14.09 Update Liam says when to use it and picks the due date on a calendar in the app's date style; Resolve shows an example", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await inProgress(await team.as("Liam"), team, "rake-agent", "RAKE Agent training calendar");
  const panel = await openPanel(page, ref);
  await headerButton(panel, "Update Liam").click();
  const update = actionDialog(page, "Update Liam on progress");
  await expect(update).toContainText("a fix ready to try");
  await expect(update.locator("#expected-by")).toHaveText("Pick a date");
  await update.locator("#expected-by").click();
  await page.getByRole("grid").locator("button:not([disabled])").last().click();
  const picked = update.locator("#expected-by");
  await expect(picked).toHaveText(/^[A-Z][a-z]{2},? \d{1,2} [A-Z][a-z]{2}$/);
  await expect(picked).not.toHaveText(/\d+\/\d+\/\d{4}/);
  await expect(update.getByRole("checkbox", { name: /Ask them to check it/ })).toBeVisible();
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
  await updateButton(panel).click();
  const dialog = updateDialog(darlene);
  await expect(dialog).toContainText("Now due");
  await pickExpectedBy(darlene, dialog, later);
  const why = dialog.getByRole("textbox", { name: "Why the date moved (only the Digital team sees it)" });
  await expect(why).toBeVisible();
  await submit(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveText("Say why the due date moved.");
  await why.fill(reason);
  await submit(dialog).click();
  await expect(darlene.getByText("Saved", { exact: true })).toBeVisible();
  await openActivity(panel, "History");
  await expect(panel.getByRole("region", { name: "History" })).toContainText(`: ${reason}`);

  const told = (await getJson<{ items: { title: string; body: string }[] }>(chris, "/notifications")).items.find((n) => n.title.startsWith(`${ref}: due date moved from`));
  expect(told?.body).toBe(`Darlene: ${reason}`);

  // Tom sees the new date, never the reason.
  await openTracker(page, ref);
  await expect(band(page)).toContainText(dayText(later));
  await expect(page.getByRole("main")).not.toContainText("vendor");
});
