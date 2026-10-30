import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, holderOf, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 11 (Staff: What's new). Releases come from the Friday drafter, set up
// through the API as Chris (an Admin, who can publish for any project) and each item's holder; the
// checks are on /whats-new.

test.beforeAll(resetDatabase);

// The release is built once, by whichever test needs it first, and shared with the ones after it.
test.describe.configure({ mode: "serial" });

type Team = { as: (first: string) => Promise<Page> };
type ReleaseRow = { id: string; project: { slug: string; name: string }; status: string };
type ReleaseDetail = ReleaseRow & {
  items: { id: string; title: string; body: string; work_type: string | null; source_type: string; visible_to_staff: boolean }[];
};

const IMPACT = ["Slowing me down", "I expected it to open but got a blank screen"];

// What goes into the releases. Titles are the feedback's own first sentence.
const NEW_ITEM = "Please add a dark mode to RAKE Agent"; // Liam's: New
const IMPROVED_ITEM = "The RAKE Agent answer history is confusing to read"; // Aisha's: Improved
const FIXED_ITEM = "The RAKE Agent reply page shows an error when I open it"; // Aisha's: Fixed
const UNTICKED_ITEM = "The RAKE Agent export page shows an error when I open it"; // resolved, but the owner unticks it
const IN_PROGRESS_ITEM = "The RAKE Agent sharing page shows an error when I open it"; // still being worked on: an unticked "In progress" draft item
const PORTAL_ITEM = "The Training Portal course list shows an error when I open it"; // second tool's release
const PROGRESS_UPDATE = "Progress detail: waiting on the vendor, Darlene has the logs";
const INTERNAL_NOTE = "Internal note: Aisha escalated this, code 7731";
const STAFF_NAMES = /\b(Liam|Aisha|Tom|Grace|Rafael|Mei|Darlene|Mario|Marc|Chris|Mike)\b/;

let published: Promise<void> | null = null;

/**
 * One published release for RAKE Agent (New, Improved, Fixed, plus items that stay unticked)
 * and one for the Training Portal, published after it. Built once per file; the drafter makes
 * only one draft per tool per week, so a second build would find the first.
 */
function publishReleases(team: Team) {
  published ??= (async () => {
    const [liam, aisha, chris] = await Promise.all([team.as("Liam"), team.as("Aisha"), team.as("Chris")]);
    const approve = (ref: string) => postJson(chris, `/console/items/${ref}/approve`);
    const holder = async (ref: string) => team.as(await holderOf(chris, ref));
    const resolve = async (ref: string) => {
      await approve(ref);
      await postJson(await holder(ref), `/console/items/${ref}/resolve`, { body: "Done in this week's update" });
    };

    await resolve(await raise(liam, NEW_ITEM, IMPACT, "rake-agent"));
    await resolve(await raise(aisha, IMPROVED_ITEM, IMPACT, "rake-agent"));
    const fixed = await raiseBug(aisha, "rake-agent", FIXED_ITEM);
    await resolve(fixed);
    await postJson(chris, `/console/items/${fixed}/note`, { body: INTERNAL_NOTE });
    await resolve(await raiseBug(aisha, "rake-agent", UNTICKED_ITEM));
    const working = await raiseBug(aisha, "rake-agent", IN_PROGRESS_ITEM);
    await approve(working);
    const worker = await holder(working);
    await postJson(worker, `/console/items/${working}/start`);
    await postJson(worker, `/console/items/${working}/update`, { body: PROGRESS_UPDATE });
    await resolve(await raiseBug(aisha, "training-portal", PORTAL_ITEM));

    await postJson(chris, "/console/releases/draft-now");
    const drafts = await getJson<ReleaseRow[]>(chris, "/console/releases");
    const draft = (slug: string) => drafts.find((r) => r.project.slug === slug && r.status === "draft")!;

    // The owner's edit: untick the export item. The drafter's own item from the
    // in-progress update starts unticked already.
    const rake = await getJson<ReleaseDetail>(chris, `/console/releases/${draft("rake-agent").id}`);
    const kept = rake.items.map((i) => ({ ...i, visible_to_staff: i.visible_to_staff && !i.title.includes("export page") }));
    const saved = await chris.request.put(`/api/console/releases/${rake.id}/items`, { data: { items: kept } });
    expect(saved.ok(), `PUT items -> ${saved.status()}`).toBeTruthy();

    await postJson(chris, `/console/releases/${rake.id}/publish`);
    await postJson(chris, `/console/releases/${draft("training-portal").id}/publish`);
  })();
  return published;
}

test("S11.01 Before anything is published, Fixes and updates says nothing is published yet", async ({ page, signIn }) => {
  await signIn("Liam");
  await page.goto("/whats-new");
  await expect(page.getByRole("heading", { name: "Fixes and updates" })).toBeVisible();
  await expect(page.getByText("Nothing published yet. Each Friday the Digital team shares what changed.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter by tool" })).toHaveCount(0);
});

test.describe("once releases are published", () => {
  // Raising and resolving six items through the stub takes a while on the first test.
  test.describe.configure({ timeout: 120_000 });

  test("S11.02 One card per project with Week ending, items grouped Fixed, Improved, New", async ({ page, signIn, team }) => {
    await publishReleases(team);
    await signIn("Liam");
    await page.goto("/whats-new");

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(2);
    // The release published last comes first.
    await expect(cards.getByRole("heading", { level: 2 })).toHaveText(["Training Portal", "RAKE Agent"]);
    for (const card of await cards.all()) await expect(card.getByText(/Week ending Fri,? \d{1,2} [A-Za-z]{3}/)).toBeVisible();

    const rake = cards.filter({ has: page.getByRole("heading", { level: 2, name: "RAKE Agent" }) });
    await expect(rake.getByRole("heading", { level: 3 })).toHaveText(["Fixed", "Improved", "New"]);
    const section = (name: string) => rake.locator("section").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
    await expect(section("New").getByRole("listitem")).toHaveCount(1);
    await expect(section("New").getByRole("listitem")).toContainText(NEW_ITEM);
    await expect(section("Improved").getByRole("listitem")).toContainText(IMPROVED_ITEM);
    await expect(section("Fixed").getByRole("listitem")).toContainText(FIXED_ITEM);

    const portal = cards.filter({ has: page.getByRole("heading", { level: 2, name: "Training Portal" }) });
    await expect(portal.getByRole("heading", { level: 3 })).toHaveText(["Fixed"]);
    await expect(portal).toContainText(PORTAL_ITEM);
  });

  test("S11.03 The tool chips filter the list to that tool", async ({ page, signIn, team }) => {
    await publishReleases(team);
    await signIn("Liam");
    await page.goto("/whats-new");

    const chips = page.getByRole("group", { name: "Filter by tool" });
    await expect(chips.getByRole("button", { name: "All tools" })).toHaveAttribute("aria-pressed", "true");
    const heading = (name: string) => page.getByRole("article").getByRole("heading", { level: 2, name });

    await chips.getByRole("button", { name: "Training Portal" }).click();
    await expect(chips.getByRole("button", { name: "Training Portal" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(heading("Training Portal")).toBeVisible();
    await expect(heading("RAKE Agent")).toHaveCount(0);

    await chips.getByRole("button", { name: "RAKE Agent" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(heading("RAKE Agent")).toBeVisible();
    await expect(heading("Training Portal")).toHaveCount(0);

    await chips.getByRole("button", { name: "All tools" }).click();
    await expect(page.getByRole("article")).toHaveCount(2);
  });

  test("S11.04 The person whose feedback is in the release sees From your feedback and was notified", async ({ page, signIn, team }) => {
    await publishReleases(team);
    await signIn("Liam");
    await page.goto("/whats-new");

    // Liam raised only the dark mode item; the other released items are Aisha's.
    await expect(page.getByText("From your feedback")).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: NEW_ITEM })).toContainText("From your feedback");
    await expect(page.getByRole("listitem").filter({ hasText: FIXED_ITEM })).not.toContainText("From your feedback");

    await page.getByRole("button", { name: /^Notifications/ }).click();
    // The bell row (D78) also lists the step in its trail, so find the row, not the text.
    await expect(page.getByRole("link", { name: /Your feedback made it into this week's RAKE Agent fixes and updates/ })).toBeVisible();
  });

  test("S11.05 Published items leave out unticked items, staff names and internal notes", async ({ page, signIn, team }) => {
    await publishReleases(team);
    await signIn("Liam");
    await page.goto("/whats-new");

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(2);
    // Only the ticked items: three for RAKE Agent (New, Improved, Fixed), one for the Training Portal.
    await expect(cards.getByRole("listitem")).toHaveCount(4);

    const text = (await cards.allInnerTexts()).join("\n");
    expect(text).not.toContain(UNTICKED_ITEM);
    expect(text).not.toContain("In progress:");
    expect(text).not.toContain(IN_PROGRESS_ITEM);
    expect(text).not.toContain(PROGRESS_UPDATE);
    expect(text).not.toContain("rollout checklist");
    expect(text).not.toContain("code 7731");
    expect(text).not.toMatch(STAFF_NAMES);
  });
});
