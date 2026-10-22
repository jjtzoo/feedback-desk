import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, pdf, postJson, raise, signOut } from "./helpers";

// Manual checklist section 12 (Digital Staff: the board). Dragging cards and the keyboard move are
// left for Stage 3; the rest (landing, columns, counts, cards, saved view, inbox tabs, filters, List
// and Cards) is checked here. The people and items are made through the API, then looked at on /console.

test.beforeAll(resetDatabase);

// Raising a dozen items through the stub takes a while, and the filter tests loop over three views.
test.describe.configure({ timeout: 120_000 });

type Team = { as: (first: string) => Promise<Page> };
type View = "Board" | "List" | "Cards";
type Card = {
  reference: string;
  title: string;
  summary: string;
  project: { slug: string; name: string } | null;
  work_type: string | null;
  category: string | null;
  priority: string | null;
  status: string;
  submitter_name: string;
  assignee: { name: string } | null;
  created_at: string;
};

const IMPACT = ["Slowing me down", "I expected it to open but got a blank screen"];
const MINOR = ["It's minor", "I expected it to open but got a blank screen"];

// What is on the board. The stub makes the title from the first sentence, so each text is its own title.
// RAKE Agent is Darlene's, the Training Portal is Marc's and the CPD Tracker is Mario's.
const TEXT = {
  p1: "The RAKE Agent export crashes and it is blocking my work", // Liam: P1, Approved, overdue, a file, an unread reply
  due: "The RAKE Agent summary page shows an error when I open it", // Aisha: P2, Approved, due far ahead
  plain: "The RAKE Agent login loops with an error after I sign in", // Tom: P3, Approved, no date, nothing extra
  overdue2: "The RAKE Agent sync is stuck with an error", // Grace: P2, Approved, overdue
  progress: "The RAKE Agent answer history is confusing to read", // Grace: improvement, In progress, overdue
  resolved: "Please add a dark mode to the RAKE Agent", // Rafael: new feature, Resolved
  closed: "The RAKE Agent report download is broken and shows a blank page", // Mei: Closed
  awaiting: "The RAKE Agent upload button is broken", // Tom: Awaiting approval, Darlene's
  flagged: "Darlene is useless, the RAKE agent keeps crashing", // Rafael: flagged, Needs review, nobody's
  review: "The export button is broken and it's annoying", // Mei: no tool, Needs review
  portal: "The Training Portal certificate page shows an error", // Aisha: Awaiting approval, Marc's
  cpd: "Please add an export to the CPD Tracker", // Liam: Awaiting approval, Mario's
};
type Key = keyof typeof TEXT;
type World = Record<Key, string>;

const PAST = "2026-09-15";
const PAST_TOO = "2026-09-20";
const FAR_AHEAD = "2099-06-15";
const OVERDUE: Key[] = ["p1", "overdue2", "progress"];

/** The references, by what the item is for. Built once in beforeAll. */
let world: World;

async function buildWorld(team: Team): Promise<World> {
  const [liam, aisha, tom, grace, rafael, mei, chris, darlene] = await Promise.all(
    ["Liam", "Aisha", "Tom", "Grace", "Rafael", "Mei", "Chris", "Darlene"].map((name) => team.as(name)),
  );
  const refs = {} as World;
  refs.p1 = await raise(liam, TEXT.p1, IMPACT, "rake-agent");
  refs.due = await raise(aisha, TEXT.due, IMPACT, "rake-agent");
  refs.plain = await raise(tom, TEXT.plain, MINOR, "rake-agent");
  refs.overdue2 = await raise(grace, TEXT.overdue2, IMPACT, "rake-agent");
  refs.progress = await raise(grace, TEXT.progress, IMPACT, "rake-agent");
  refs.resolved = await raise(rafael, TEXT.resolved, IMPACT, "rake-agent");
  refs.closed = await raise(mei, TEXT.closed, IMPACT, "rake-agent");
  refs.awaiting = await raise(tom, TEXT.awaiting, IMPACT, "rake-agent");
  refs.flagged = await raise(rafael, TEXT.flagged, IMPACT, "rake-agent");
  refs.review = await raise(mei, TEXT.review, ["Not sure", "I expected the export to work but got a blank screen"]);
  refs.portal = await raise(aisha, TEXT.portal, IMPACT, "training-portal");
  refs.cpd = await raise(liam, TEXT.cpd, IMPACT, "cpd-tracker");

  for (const key of ["p1", "due", "plain", "overdue2", "progress", "resolved", "closed"] as Key[]) {
    await postJson(chris, `/console/items/${refs[key]}/approve`);
  }
  await postJson(darlene, `/console/items/${refs.progress}/start`);
  await postJson(darlene, `/console/items/${refs.resolved}/resolve`, { body: "Dark mode is on the list for the next release" });
  await postJson(darlene, `/console/items/${refs.closed}/close`, { reason: "Not needed any more" });
  for (const [key, expected_by] of [["p1", PAST], ["overdue2", PAST_TOO], ["progress", PAST], ["due", FAR_AHEAD]] as const) {
    await postJson(darlene, `/console/items/${refs[key]}/update`, { body: "Chasing this up", expected_by });
  }

  // Last, because every call Darlene makes on an item returns its detail, which marks it read for her.
  await postJson(liam, `/feedback/${refs.p1}/replies`, { body: "Any news on this? It is still stopping my exports." });
  const file = await liam.request.post(`/api/feedback/${refs.p1}/attachments`, { multipart: { file: pdf("export-log.pdf") } });
  expect(file.ok(), `attach -> ${file.status()}`).toBeTruthy();
  return refs;
}

test.beforeAll(async ({ team }) => {
  test.setTimeout(240_000);
  world = await buildWorld(team);
});

// What the person sees. A board card is a draggable wrapper around the card button, so cards are found by the wrapper.
const CARD = '[aria-roledescription^="Draggable card"]';
const COLUMN = 'section[aria-label$=" items"]';
const column = (page: Page, title: string) => page.getByRole("region", { name: new RegExp(`^${title}, \\d+ items$`) });
// The card's text runs on without spaces ("FB-0001P1"), so the reference ends where the digits do, not at a word edge.
const boardCard = (page: Page, ref: string) => page.locator(CARD).filter({ hasText: new RegExp(`${ref}(?!\\d)`) });
const viewButton = (page: Page, view: View) => page.getByRole("group", { name: "View" }).getByRole("button", { name: view, exact: true });
const inboxTab = (page: Page, label: string) => page.getByRole("tab", { name: label, exact: true });

/** The page's first loads: the board, and the projects that fill the Project filter. */
const workLoaded = (page: Page) =>
  Promise.all(["/api/console/board", "/api/projects"].map((path) => page.waitForResponse((r) => r.url().includes(path) && r.ok())));

/** Open /console and wait for the page's first loads, so the page is ready to be clicked. */
async function gotoWork(page: Page, query = "") {
  const loaded = workLoaded(page);
  await page.goto(`/console${query}`);
  await loaded;
}

async function reloadWork(page: Page) {
  const loaded = workLoaded(page);
  await page.reload();
  await loaded;
}

/** Open the Work page and choose a view (this also saves it as the person's view). */
async function openWork(page: Page, view: View, query = "") {
  await gotoWork(page, query);
  await viewButton(page, view).click();
  await expect(viewButton(page, view)).toHaveAttribute("aria-pressed", "true");
  if (view === "Board") await expect(page.locator(COLUMN).first()).toBeVisible();
  if (view === "List") await expect(page.getByRole("columnheader", { name: "Ref" })).toBeVisible();
}

/** The references on screen in this view, in the order shown. */
async function shownRefs(page: Page, view: View) {
  const texts =
    view === "Board"
      ? await page.locator(CARD).allInnerTexts()
      : view === "List"
        ? await page.locator("tbody tr").allInnerTexts()
        : await page.getByRole("button", { name: /FB-\d{4}/ }).allInnerTexts();
  return texts.map((t) => t.match(/FB-\d{4}/)?.[0] ?? "").filter(Boolean);
}

async function expectRefs(page: Page, view: View, refs: string[]) {
  await expect.poll(async () => (await shownRefs(page, view)).sort(), { message: `${view} shows these items` }).toEqual([...refs].sort());
}

/** Every item in the system as the console API sees it, for working out what a screen should show. */
async function allCards(page: Page) {
  return (await getJson<{ items: Card[] }>(page, "/console/items?inbox=all&sort=newest")).items;
}

const OPEN = ["new", "needs_review", "awaiting_approval", "approved", "in_progress", "resolved"];
const CLOSED = ["acknowledged", "declined", "closed"];
const refsOf = (cards: Card[]) => cards.map((c) => c.reference);

test("S12.01 As Darlene, /console opens the Work page on 'Assigned to me' in Board view", async ({ page, signIn }) => {
  await signIn("Darlene");
  await gotoWork(page);
  await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
  await expect(inboxTab(page, "Assigned to me")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(COLUMN).first()).toBeVisible();
  await expect(viewButton(page, "Board")).toHaveAttribute("aria-pressed", "true");
  await expect(viewButton(page, "List")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("columnheader")).toHaveCount(0);
});

test("S12.02 Darlene's board has Approved, In progress, Resolved and Closed; Marc's also has Needs review and Awaiting approval", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  await openWork(page, "Board");
  await expect(page.locator(`${COLUMN} h2`)).toHaveText([/^Approved \d+$/, /^In progress \d+$/, /^Resolved \d+$/, /^Closed \d+$/]);

  const marc = await team.as("Marc");
  await openWork(marc, "Board");
  await expect(marc.locator(`${COLUMN} h2`)).toHaveText([
    /^Needs review \d+$/,
    /^Awaiting approval \d+$/,
    /^Approved \d+$/,
    /^In progress \d+$/,
    /^Resolved \d+$/,
    /^Closed \d+$/,
  ]);
});

test("S12.03 A column header shows the item count, and 'N overdue' when a card in it is overdue", async ({ page, signIn }) => {
  await signIn("Darlene");
  await openWork(page, "Board");

  // Approved holds four of Darlene's items, two of them overdue; In progress one, overdue; Resolved and Closed one each, none overdue.
  const approved = column(page, "Approved");
  await expect(approved.getByRole("heading", { level: 2 })).toHaveText("Approved 4");
  await expect(approved.locator(CARD)).toHaveCount(4);
  await expect(approved.getByText("2 overdue")).toBeVisible();

  const inProgress = column(page, "In progress");
  await expect(inProgress.getByRole("heading", { level: 2 })).toHaveText("In progress 1");
  await expect(inProgress.getByText("1 overdue")).toBeVisible();

  for (const title of ["Resolved", "Closed"]) {
    const done = column(page, title);
    await expect(done.getByRole("heading", { level: 2 })).toHaveText(`${title} 1`);
    await expect(done.getByText(/\d+ overdue/)).toHaveCount(0);
  }
});

test("S12.04 A card shows its reference, work type, priority badge (P1 outlined), title, tool, submitter, age, Due or Overdue date, and the file, unread and Flagged marks", async ({
  page,
  signIn,
  team,
}) => {
  await signIn("Darlene");
  await openWork(page, "Board");

  // The busy card: a P1 that is overdue, has a file and an unread reply from its submitter.
  const busy = boardCard(page, world.p1);
  await expect(busy.getByText(world.p1, { exact: true })).toBeVisible();
  await expect(busy.getByText(TEXT.p1, { exact: true })).toBeVisible();
  await expect(busy.getByText("Fix · RAKE Agent · Liam Carter", { exact: true })).toBeVisible();
  await expect(busy.getByText("P1 · Blocking", { exact: true })).toHaveClass(/border-primary/);
  await expect(busy.locator("time")).toHaveText(/^(now|\d+ [mhd])$/);
  const overdue = busy.getByText(/^Overdue · .*15 Sept?$/);
  await expect(overdue).toBeVisible();
  await expect(overdue).toHaveClass(/text-destructive/);
  await expect(busy.getByText("Has files")).toHaveCount(1);
  await expect(busy.getByLabel("Unread reply from the submitter")).toBeVisible();
  await expect(busy.getByText("Flagged")).toHaveCount(0);

  // A card with a date far ahead says "Due", not red.
  const due = boardCard(page, world.due);
  const dueDate = due.getByText(/^Due .*15 June?$/);
  await expect(dueDate).toBeVisible();
  await expect(dueDate).not.toHaveClass(/text-destructive/);
  await expect(due.getByText(/^P2 · Major$/)).not.toHaveClass(/border-primary/);

  // A plain card has none of the extras.
  const plain = boardCard(page, world.plain);
  await expect(plain.getByText("Fix · RAKE Agent · Tom Nguyen", { exact: true })).toBeVisible();
  await expect(plain.getByText(/^P\d · /)).not.toHaveClass(/border-primary/);
  await expect(plain.getByText("Has files")).toHaveCount(0);
  await expect(plain.getByLabel("Unread reply from the submitter")).toHaveCount(0);
  await expect(plain.getByText(/^(Due|Overdue)/)).toHaveCount(0);
  await expect(plain.getByText("Flagged")).toHaveCount(0);

  // A flagged item is nobody's, so it shows to Marc in Needs review.
  const marc = await team.as("Marc");
  await openWork(marc, "Board", "?inbox=open");
  const flagged = boardCard(marc, world.flagged);
  await expect(flagged.getByText(TEXT.flagged, { exact: true })).toBeVisible();
  const mark = flagged.getByText("Flagged", { exact: true });
  await expect(mark).toBeVisible();
  await expect(mark).toHaveClass(/text-destructive/);
  await expect(boardCard(marc, world.p1).getByText("Flagged")).toHaveCount(0);
});

test("S12.05 Dragging an Approved card to In progress toasts '… moved to In progress' and ticks In progress on the submitter's tracker", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.06 Dragging an In progress card to Resolved opens a dialog that requires 'What was done'", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.07 Dragging a card to Closed opens the Close dialog", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.08 As Marc, dragging an Awaiting approval card to In progress is refused and the card stays", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.09 As Marc, dragging an Awaiting approval card to Approved approves it", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.10 Moving a card with the keyboard (Tab, Space, arrows, Space) gives the same result as dragging", async () => {
  test.skip(true, "Stage 3: board drag-and-drop");
});

test("S12.11 The chosen view (List) survives a reload and signing out and in; Mario, who never chose, gets Board", async ({ page, signIn }) => {
  const stillList = async () => {
    await expect(page.getByRole("columnheader", { name: "Ref" })).toBeVisible();
    await expect(viewButton(page, "List")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(COLUMN)).toHaveCount(0);
  };

  // Mike has nothing assigned, so he looks at All open; with an empty inbox the table would not show at all.
  await signIn("Mike");
  await openWork(page, "List", "?inbox=open");
  await reloadWork(page);
  await stillList();

  await signOut(page);
  await signIn("Mike");
  await gotoWork(page, "?inbox=open");
  await stillList();

  await signOut(page);
  await signIn("Mario");
  await gotoWork(page);
  await expect(page.locator(COLUMN).first()).toBeVisible();
  await expect(viewButton(page, "Board")).toHaveAttribute("aria-pressed", "true");
  await expect(viewButton(page, "List")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("columnheader")).toHaveCount(0);
});

test("S12.12 Each inbox tab (Assigned to me, Unassigned / needs review, All open, Overdue, Closed) filters Board, List and Cards", async ({ page, signIn }) => {
  await signIn("Marc");
  const cards = await allCards(page);
  const inboxes = [
    { label: "Assigned to me", refs: refsOf(cards.filter((c) => c.assignee?.name === "Marc")) },
    {
      label: "Unassigned / needs review",
      refs: refsOf(cards.filter((c) => ["needs_review", "new"].includes(c.status) || (!c.assignee && OPEN.includes(c.status)))),
    },
    { label: "All open", refs: refsOf(cards.filter((c) => OPEN.includes(c.status))) },
    { label: "Overdue", refs: OVERDUE.map((key) => world[key]) },
    { label: "Closed", refs: refsOf(cards.filter((c) => CLOSED.includes(c.status))) },
  ];
  // Every tab has something to show, so an empty screen can never pass for the right answer.
  for (const inbox of inboxes) expect(inbox.refs.length, inbox.label).toBeGreaterThan(0);
  expect(new Set(inboxes.map((i) => [...i.refs].sort().join())).size).toBe(inboxes.length);

  for (const view of ["Board", "List", "Cards"] as const) {
    await openWork(page, view);
    for (const inbox of inboxes) {
      await inboxTab(page, inbox.label).click();
      await expect(inboxTab(page, inbox.label)).toHaveAttribute("aria-selected", "true");
      await expectRefs(page, view, inbox.refs);
    }
  }
});

test("S12.13 The project, work type, category and priority filters and the search narrow every view, and the filters stay in the address", async ({ page, signIn }) => {
  await signIn("Marc");
  const open = (await allCards(page)).filter((c) => OPEN.includes(c.status));
  const filters = [
    { label: "Project", option: "RAKE Agent", all: "All projects", param: "project", value: "rake-agent", match: (c: Card) => c.project?.slug === "rake-agent" },
    { label: "Work type", option: "Improvement", all: "All work types", param: "work_type", value: "improvement", match: (c: Card) => c.work_type === "improvement" },
    { label: "Category", option: "Bug", all: "All categories", param: "category", value: "bug", match: (c: Card) => c.category === "bug" },
    { label: "Priority", option: "P2", all: "All priorities", param: "priority", value: "P2", match: (c: Card) => c.priority === "P2" },
  ];
  // An FB number, a word from a title and a person's name.
  const searches = [world.due, "dark", "Rafael"];
  const found = (q: string) => (c: Card) => [c.title, c.summary, c.reference, c.submitter_name].some((s) => s.toLowerCase().includes(q.toLowerCase()));

  // Each one keeps some items and drops some, so narrowing is really shown.
  for (const f of filters) {
    const kept = open.filter(f.match).length;
    expect(kept, `${f.label} keeps some`).toBeGreaterThan(0);
    expect(kept, `${f.label} drops some`).toBeLessThan(open.length);
  }
  for (const q of searches) {
    const kept = open.filter(found(q)).length;
    expect(kept, `search ${q} keeps some`).toBeGreaterThan(0);
    expect(kept, `search ${q} drops some`).toBeLessThan(open.length);
  }

  const pick = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const search = async (text: string) => {
    const box = page.getByRole("textbox", { name: "Search", exact: true });
    await box.fill(text);
    await box.press("Enter");
  };

  for (const view of ["Board", "List", "Cards"] as const) {
    await openWork(page, view, "?inbox=open");
    await expectRefs(page, view, refsOf(open));

    for (const f of filters) {
      await pick(f.label, f.option);
      await expect(page).toHaveURL(new RegExp(`[?&]${f.param}=${f.value}(&|$)`));
      await expectRefs(page, view, refsOf(open.filter(f.match)));
      await pick(f.label, f.all);
      await expectRefs(page, view, refsOf(open));
    }
    for (const q of searches) {
      await search(q);
      await expect(page).toHaveURL(new RegExp(`[?&]q=${q}(&|$)`));
      await expectRefs(page, view, refsOf(open.filter(found(q))));
      await search("");
      await expectRefs(page, view, refsOf(open));
    }
  }

  // Two filters together, then a reload: the address holds them, so the same items are shown.
  const both = open.filter((c) => c.project?.slug === "rake-agent" && c.priority === "P2");
  expect(both.length, "project and priority together").toBeGreaterThan(0);
  await pick("Project", "RAKE Agent");
  await expect(page).toHaveURL(/[?&]project=rake-agent(&|$)/);
  await pick("Priority", "P2");
  await expect(page).toHaveURL(/[?&]priority=P2(&|$)/);
  await expectRefs(page, "Cards", refsOf(both));
  await reloadWork(page);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveText("RAKE Agent");
  await expect(page.getByRole("combobox", { name: "Priority" })).toHaveText("P2");
  await expectRefs(page, "Cards", refsOf(both));
});

test("S12.14 List view has the columns Ref, Title, Project, Type, Priority, Stage, Assignee, Age and Expected by (red when overdue)", async ({ page, signIn }) => {
  await signIn("Darlene");
  await openWork(page, "List");
  await expect(page.getByRole("columnheader")).toHaveText(["Ref", "Title", "Project", "Type", "Priority", "Stage", "Assignee", "Age", "Expected by"]);

  const overdue = page.getByRole("row").filter({ hasText: world.p1 });
  await expect(overdue.getByRole("cell")).toHaveText([world.p1, TEXT.p1, "RAKE Agent", "Fix", "P1 · Blocking", "Approved", "Darlene", /^(now|\d+ [mhd])$/, /15 Sep/]);
  await expect(overdue.getByRole("cell").nth(8)).toHaveClass(/text-destructive/);

  const ahead = page.getByRole("row").filter({ hasText: world.due });
  await expect(ahead.getByRole("cell").nth(8)).toHaveText(/15 Jun/);
  await expect(ahead.getByRole("cell").nth(8)).not.toHaveClass(/text-destructive/);
});

test("S12.15 Cards view is one column of cards, most urgent first", async ({ page, signIn }) => {
  await signIn("Marc");
  const rank: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
  const urgent = (await allCards(page))
    .filter((c) => OPEN.includes(c.status))
    .sort((a, b) => (rank[a.priority ?? ""] ?? 9) - (rank[b.priority ?? ""] ?? 9) || Date.parse(a.created_at) - Date.parse(b.created_at));
  // Several priorities are present, so "most urgent first" is a real order.
  expect(new Set(urgent.map((c) => c.priority)).size).toBeGreaterThan(2);

  await openWork(page, "Cards", "?inbox=open");
  await expect.poll(() => shownRefs(page, "Cards")).toEqual(refsOf(urgent));

  const boxes = await Promise.all((await page.getByRole("button", { name: /FB-\d{4}/ }).all()).map((c) => c.boundingBox()));
  expect(boxes).toHaveLength(urgent.length);
  const shown = boxes.map((b) => b!);
  for (const [i, b] of shown.entries()) {
    expect(Math.abs(b.x - shown[0].x), `card ${i + 1} lines up with the first`).toBeLessThan(1);
    if (i > 0) expect(b.y, `card ${i + 1} is below card ${i}`).toBeGreaterThan(shown[i - 1].y);
  }
});
