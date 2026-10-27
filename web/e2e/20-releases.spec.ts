import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, holderOf, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 20 (Admin and owners: Friday releases). The week's activity is set up
// through the API (as Chris, an Admin, and each item's holder); the drafter, the review page and the checks are on the screen.

test.beforeAll(resetDatabase);

// Raising and resolving seven items through the stub takes a while on the first test.
test.describe.configure({ timeout: 180_000 });

type Team = { as: (first: string) => Promise<Page> };
type ReleaseRow = { id: string; project: { slug: string; name: string }; status: string };
type ReleaseDetail = ReleaseRow & {
  items: { id: string; title: string; body: string; work_type: string | null; source_type: string; visible_to_staff: boolean }[];
};

const IMPACT = ["Slowing me down", "I expected it to open but got a blank screen"];

// This week's activity. RAKE Agent is Darlene's, CPD Tracker is Mario's, Training Portal is Marc's;
// every other tool is quiet.
const NEW_ITEM = "Please add a dark mode to RAKE Agent"; // Liam's: ticked, published in S20.07
const FIXED_ITEM = "The RAKE Agent reply page shows an error when I open it"; // Aisha's: reworded in S20.04
const IN_PROGRESS_ITEM = "The RAKE Agent sharing page shows an error when I open it"; // still in progress: unticked "Progress update"
const CHANNEL_NOTE = "Channel note for the team: rollout checklist ready, Mario to review";
const PROGRESS_UPDATE = "Progress detail: waiting on the vendor, Darlene has the logs";
const CPD_ITEMS = ["The CPD Tracker points page shows an error when I open it", "The CPD Tracker export page shows an error when I open it"];
const PORTAL_ITEM = "The Training Portal course list shows an error when I open it"; // left as a draft in S20.08

const SOURCE = {
  feedback: "Resolved feedback",
  progress: "Progress update",
  channel: "Project channel (internal, unticked by default)",
  manual: "Added by hand",
};
const PUBLISH = "Approve and publish";
const DRAFT_READY = (tool: string) => `This week's ${tool} release is ready to review`;

let seeded: Promise<void> | null = null;
let drafted: Promise<void> | null = null;

/**
 * Resolved feedback, a progress update and a channel note for RAKE Agent, two resolved items for
 * CPD Tracker and one for the Training Portal. Built once per file; no draft exists yet.
 */
function seedActivity(team: Team) {
  seeded ??= (async () => {
    const [liam, aisha, tom, grace, rafael, chris] = await Promise.all(["Liam", "Aisha", "Tom", "Grace", "Rafael", "Chris"].map((n) => team.as(n)));
    const approve = (ref: string) => postJson(chris, `/console/items/${ref}/approve`);
    const holder = async (ref: string) => team.as(await holderOf(chris, ref));
    const resolve = async (ref: string) => {
      await approve(ref);
      await postJson(await holder(ref), `/console/items/${ref}/resolve`, { body: "Done in this week's update" });
    };

    await resolve(await raise(liam, NEW_ITEM, IMPACT, "rake-agent"));
    await resolve(await raiseBug(aisha, "rake-agent", FIXED_ITEM));
    const working = await raiseBug(aisha, "rake-agent", IN_PROGRESS_ITEM);
    await approve(working);
    const worker = await holder(working);
    await postJson(worker, `/console/items/${working}/start`);
    await postJson(worker, `/console/items/${working}/update`, { body: PROGRESS_UPDATE });
    await postJson(chris, "/console/channels/rake-agent", { body: CHANNEL_NOTE });
    await resolve(await raiseBug(tom, "cpd-tracker", CPD_ITEMS[0]));
    await resolve(await raiseBug(grace, "cpd-tracker", CPD_ITEMS[1]));
    await resolve(await raiseBug(rafael, "training-portal", PORTAL_ITEM));
  })();
  return seeded;
}

/** The drafts exist: activity seeded, then the drafter run by Chris through the API (it never makes a second draft for a project and week). */
function draftsReady(team: Team) {
  drafted ??= (async () => {
    await seedActivity(team);
    await postJson(await team.as("Chris"), "/console/releases/draft-now");
  })();
  return drafted;
}

/** Open a project's release from the Releases list, the way a person does. */
async function openRelease(page: Page, project: string) {
  await page.goto("/console/releases");
  await page.getByRole("link", { name: new RegExp(`^${project}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  await expect(page.getByLabel("Title").first()).toBeVisible();
}

/** What every item's title box holds, in order. */
function titles(page: Page) {
  return page.getByLabel("Title").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

/** The review page's item whose title holds this text. */
async function itemRow(page: Page, text: string) {
  const index = (await titles(page)).findIndex((t) => t.includes(text));
  expect(index, `no item titled "${text}"`).toBeGreaterThanOrEqual(0);
  return page.locator("ol > li").nth(index);
}

/** Tick only the item with this title and untick the rest, as the owner would on the review page. */
async function tickOnly(page: Page, keep: string) {
  const all = await titles(page);
  for (const [i, title] of all.entries()) {
    const box = page.locator("ol > li").nth(i).getByRole("checkbox", { name: "Staff can see this" });
    if (title.includes(keep)) await box.check();
    else await box.uncheck();
  }
}

test("S20.01 Draft this week now says the drafts are ready, one per project with activity and none for quiet projects", async ({ page, signIn, team }) => {
  await seedActivity(team);
  await signIn("Chris");
  await page.goto("/console/releases");
  await expect(page.getByRole("heading", { name: "Releases" })).toBeVisible();
  await expect(page.getByText("No releases yet. The first draft is prepared on Friday.")).toBeVisible();

  await page.getByRole("button", { name: "Draft this week now" }).click();
  await expect(page.getByText("This week's drafts are ready")).toBeVisible();

  // Sorted by tool name: the three with activity, nothing for the quiet ones.
  const rows = page.locator('a[href^="/console/releases/"]');
  await expect(rows).toHaveCount(3);
  await expect(rows).toHaveText([/^CPD Tracker\s*Week ending/, /^RAKE Agent\s*Week ending/, /^Training Portal\s*Week ending/]);
  for (const row of await rows.all()) await expect(row).toContainText("Draft");
  await expect(page.getByText("Published", { exact: true })).toHaveCount(0);
});

test("S20.02 Each project owner's bell shows a draft-ready notification", async ({ page, signIn, team }) => {
  await draftsReady(team);
  const bell = () => page.getByRole("button", { name: /^Notifications/ });

  await signIn("Darlene");
  await page.goto("/console");
  await bell().click();
  await expect(page.getByText(DRAFT_READY("RAKE Agent"))).toBeVisible();
  // Only the owner is told: the other tools' drafts belong to Mario and Marc.
  await expect(page.getByText(DRAFT_READY("CPD Tracker"))).toHaveCount(0);
  await expect(page.getByText(DRAFT_READY("Training Portal"))).toHaveCount(0);

  await signIn("Mario");
  await page.goto("/console");
  await bell().click();
  await expect(page.getByText(DRAFT_READY("CPD Tracker"))).toBeVisible();
  await expect(page.getByText(DRAFT_READY("RAKE Agent"))).toHaveCount(0);

  await signIn("Marc");
  await page.goto("/console");
  await bell().click();
  await expect(page.getByText(DRAFT_READY("Training Portal"))).toBeVisible();

  // The notification opens the draft.
  await page.getByText(DRAFT_READY("Training Portal")).click();
  await expect(page).toHaveURL(/\/console\/releases\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Training Portal" })).toBeVisible();
});

test("S20.03 Each draft item is labelled with its source and channel items start unticked", async ({ page, signIn, team }) => {
  await draftsReady(team);
  await signIn("Chris");
  await openRelease(page, "RAKE Agent");

  const items = page.locator("ol > li");
  await expect(items).toHaveCount(4);
  const withSource = (source: string) => items.filter({ hasText: source });
  const ticked = (row: ReturnType<typeof withSource>) => row.getByRole("checkbox", { name: "Staff can see this" });

  await expect(withSource(SOURCE.feedback)).toHaveCount(2);
  for (const row of await withSource(SOURCE.feedback).all()) await expect(ticked(row)).toBeChecked();

  await expect(withSource(SOURCE.progress)).toHaveCount(1);
  await expect(withSource(SOURCE.progress).getByLabel("Title")).toHaveValue(IN_PROGRESS_ITEM);
  await expect(ticked(withSource(SOURCE.progress))).not.toBeChecked();

  await expect(withSource(SOURCE.channel)).toHaveCount(1);
  await expect(withSource(SOURCE.channel).getByLabel("Title")).toHaveValue(CHANNEL_NOTE);
  await expect(ticked(withSource(SOURCE.channel))).not.toBeChecked();
});

test("S20.04 Editing, changing a section, removing and adding an item, then Save draft keeps the changes after reload", async ({ page, signIn, team }) => {
  await draftsReady(team);
  await signIn("Chris");
  await openRelease(page, "RAKE Agent");

  const REWORDED = "Reply page error fixed";
  const REWORDED_BODY = "Replies now open without an error page.";
  const ADDED = "Faster sign-in for RAKE Agent";
  const ADDED_BODY = "Signing in takes one step.";

  // Reword Aisha's item and move it to Other.
  const fixed = await itemRow(page, FIXED_ITEM);
  await fixed.getByLabel("Title").fill(REWORDED);
  await fixed.getByLabel("Description").fill(REWORDED_BODY);
  await fixed.getByRole("combobox", { name: "Section" }).click();
  await page.getByRole("option", { name: "Other", exact: true }).click();
  await expect(fixed.getByRole("combobox", { name: "Section" })).toContainText("Other");

  // Remove the channel item.
  const channel = await itemRow(page, CHANNEL_NOTE);
  await channel.getByRole("button", { name: "Remove item" }).click();
  await expect(page.locator("ol > li")).toHaveCount(3);

  // Add one by hand.
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator("ol > li")).toHaveCount(4);
  const added = page.locator("ol > li").last();
  await expect(added).toContainText(SOURCE.manual);
  await added.getByLabel("Title").fill(ADDED);
  await added.getByLabel("Description").fill(ADDED_BODY);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Title").first()).toBeVisible();
  const after = await titles(page);
  expect(after).toHaveLength(4);
  expect(after).toContain(REWORDED);
  expect(after).toContain(ADDED);
  expect(after.some((t) => t.includes(FIXED_ITEM))).toBe(false);
  expect(after.some((t) => t.includes(CHANNEL_NOTE))).toBe(false);

  const reworded = await itemRow(page, REWORDED);
  await expect(reworded.getByLabel("Description")).toHaveValue(REWORDED_BODY);
  await expect(reworded.getByRole("combobox", { name: "Section" })).toContainText("Other");
  const kept = await itemRow(page, ADDED);
  await expect(kept.getByLabel("Description")).toHaveValue(ADDED_BODY);
  await expect(kept).toContainText(SOURCE.manual);
});

test("S20.05 Another Digital Staff member sees a draft read-only; its owner can edit it", async ({ page, signIn, team }) => {
  await draftsReady(team);

  // CPD Tracker is Mario's.
  await signIn("Darlene");
  await page.goto("/console/releases");
  await expect(page.getByRole("link", { name: /^CPD Tracker/ })).not.toContainText("yours to review");
  await expect(page.getByRole("link", { name: /^RAKE Agent/ })).toContainText("yours to review");
  await page.getByRole("link", { name: /^CPD Tracker/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "CPD Tracker" })).toBeVisible();
  await expect(page.getByLabel("Title").first()).toBeVisible();

  await expect(page.getByText("only the project owner or an Admin can publish")).toBeVisible();
  for (const name of ["Save draft", PUBLISH, "Add item", "Remove item"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  for (const field of await page.getByLabel("Title").all()) await expect(field).toBeDisabled();
  for (const field of await page.getByLabel("Description").all()) await expect(field).toBeDisabled();
  for (const box of await page.getByRole("checkbox", { name: "Staff can see this" }).all()) await expect(box).toBeDisabled();

  await signIn("Mario");
  await openRelease(page, "CPD Tracker");
  await expect(page.getByText("only the project owner or an Admin can publish")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: PUBLISH })).toBeVisible();
  await expect(page.getByLabel("Title").first()).toBeEditable();
  await expect(page.getByRole("checkbox", { name: "Staff can see this" }).first()).toBeEnabled();
});

test("S20.06 Unticking everything disables Approve and publish", async ({ page, signIn, team }) => {
  await draftsReady(team);
  await signIn("Mario");
  await openRelease(page, "CPD Tracker");

  const publish = page.getByRole("button", { name: PUBLISH });
  const boxes = page.getByRole("checkbox", { name: "Staff can see this" });
  await expect(boxes).toHaveCount(2);
  await expect(publish).toBeEnabled();

  for (const box of await boxes.all()) await box.uncheck();
  await expect(publish).toBeDisabled();

  // One tick brings it back; nothing was saved.
  await boxes.first().check();
  await expect(publish).toBeEnabled();
});

test("S20.07 Approve and publish publishes the release, tells the contributors and shows it on What's new", async ({ page, signIn, team }) => {
  await draftsReady(team);
  await signIn("Darlene");
  await openRelease(page, "RAKE Agent");

  // Tick some: only Liam's dark mode item goes out.
  await tickOnly(page, NEW_ITEM);
  await page.getByRole("button", { name: PUBLISH }).click();
  await expect(page.getByText("Published. Staff whose feedback is in it have been told.")).toBeVisible();

  await expect(page.getByText(/Week ending .* · Published/)).toBeVisible();
  await expect(page.getByRole("button", { name: PUBLISH })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByLabel("Title").first()).toBeDisabled();

  // Liam is told, and the release is on What's new with his item marked.
  await signIn("Liam");
  await page.goto("/whats-new");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { level: 2, name: "RAKE Agent" }) });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("listitem").filter({ hasText: NEW_ITEM })).toContainText("From your feedback");
  await expect(card).not.toContainText(FIXED_ITEM);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  // The bell row (D78) also lists the step in its trail, so find the row, not the text.
  await expect(page.getByRole("link", { name: /Your feedback made it into this week's RAKE Agent fixes and updates/ })).toBeVisible();
});

test("S20.08 A draft left alone stays Draft and never appears on What's new", async ({ page, signIn, team }) => {
  await draftsReady(team);
  const chris = await team.as("Chris");
  const rows = await getJson<ReleaseRow[]>(chris, "/console/releases");
  for (const slug of ["training-portal", "cpd-tracker"]) expect(rows.find((r) => r.project.slug === slug)?.status).toBe("draft");

  await signIn("Chris");
  await page.goto("/console/releases");
  for (const tool of ["Training Portal", "CPD Tracker"]) {
    const row = page.getByRole("link", { name: new RegExp(`^${tool}`) });
    await expect(row).toContainText("Draft");
    await expect(row).not.toContainText("Published");
  }

  // Staff see none of it, whether or not RAKE Agent has been published.
  await signIn("Rafael");
  await page.goto("/whats-new");
  await expect(page.getByRole("heading", { name: "Fixes and updates" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Training Portal|CPD Tracker/ })).toHaveCount(0);
  await expect(page.getByText(PORTAL_ITEM)).toHaveCount(0);
  for (const item of CPD_ITEMS) await expect(page.getByText(item)).toHaveCount(0);
});

test("S20.09 A published release is kept in the Releases list", async ({ page, signIn, team }) => {
  await draftsReady(team);
  const chris = await team.as("Chris");

  // Publish RAKE Agent here if S20.07 has not already.
  const list = await getJson<ReleaseRow[]>(chris, "/console/releases");
  const rake = list.find((r) => r.project.slug === "rake-agent")!;
  if (rake.status === "draft") {
    const detail = await getJson<ReleaseDetail>(chris, `/console/releases/${rake.id}`);
    const items = detail.items.map((i) => ({ id: i.id, title: i.title, body: i.body, work_type: i.work_type, visible_to_staff: i.title.includes(NEW_ITEM) }));
    const saved = await chris.request.put(`/api/console/releases/${rake.id}/items`, { data: { items } });
    expect(saved.ok(), `PUT items -> ${saved.status()}`).toBeTruthy();
    await postJson(chris, `/console/releases/${rake.id}/publish`);
  }
  // The drafter runs again (a real "later" is not possible here): nothing published goes away or is drafted twice.
  await postJson(chris, "/console/releases/draft-now");

  await signIn("Mike");
  await page.goto("/console/releases");
  const row = page.getByRole("link", { name: /^RAKE Agent/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Published");
  await expect(page.getByRole("link", { name: /^Training Portal/ })).toContainText("Draft");

  await page.reload();
  await expect(row).toContainText("Published");
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "RAKE Agent" })).toBeVisible();
  await expect(page.getByText(/Week ending .* · Published/)).toBeVisible();
  expect((await titles(page)).some((t) => t.includes(NEW_ITEM))).toBe(true);
  await expect(page.getByRole("button", { name: PUBLISH })).toHaveCount(0);
});
