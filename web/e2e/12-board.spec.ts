import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, moveTo, pdf, postJson, raise, signOut, statusMoves } from "./helpers";

// Manual checklist section 12 (Digital Staff: the board): landing, columns, counts, cards, moving cards
// with the mouse and the keyboard, saved view, inbox tabs, filters, List and Cards. The people and items
// are made through the API, then looked at and moved on /console.

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
  closed: "The RAKE Agent report download is broken and shows a blank page", // Mei: Fixed
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
  await postJson(darlene, `/console/items/${refs.closed}/start`);
  await postJson(darlene, `/console/items/${refs.closed}/resolve`, { body: "The download works again" });
  // The person who raised it confirms the fix (D92).
  await postJson(mei, `/feedback/${refs.closed}/fixed`);
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
// The view switch is a toggle group (radio buttons); a tab's name ends with its count when it has one ("Overdue, 2 items").
const viewButton = (page: Page, view: View) => page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: view, exact: true });
const inboxTab = (page: Page, label: string) => page.getByRole("tab", { name: new RegExp(`^${label.replaceAll("/", "\\/")}(\\s*, \\d+ items)?$`) });

/**
 * The page's first loads: the board, and the projects that fill the Project filter. A failed load
 * fails here with its status (the page loads each once and never retries), rather than hanging.
 */
const workLoaded = (page: Page) =>
  Promise.all(
    ["/api/console/board", "/api/projects"].map(async (path) => {
      const r = await page.waitForResponse((r) => new URL(r.url()).pathname === path);
      expect(r.status(), `GET ${path} through the web server's /api proxy`).toBe(200);
    }),
  );

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
  await expect(viewButton(page, view)).toHaveAttribute("aria-checked", "true");
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
  await expect(viewButton(page, "Board")).toHaveAttribute("aria-checked", "true");
  await expect(viewButton(page, "List")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("columnheader")).toHaveCount(0);
});

test("S12.02 Darlene's board has Approved, In progress and Resolved; Marc's also has Needs review and Awaiting approval", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  await openWork(page, "Board");
  await expect(page.locator(`${COLUMN} h2`)).toHaveText([/^Approved \d+$/, /^In progress \d+$/, /^Resolved \d+$/]);

  const marc = await team.as("Marc");
  await openWork(marc, "Board");
  await expect(marc.locator(`${COLUMN} h2`)).toHaveText([
    /^Needs review \d+$/,
    /^Awaiting approval \d+$/,
    /^Approved \d+$/,
    /^In progress \d+$/,
    /^Resolved \d+$/,
  ]);
});

test("S12.03 A column header shows the item count, and 'N overdue' when a card in it is overdue", async ({ page, signIn }) => {
  await signIn("Darlene");
  await openWork(page, "Board");

  // Approved holds four of Darlene's items, two of them overdue; In progress one, overdue; Resolved one, not overdue (it is done).
  const approved = column(page, "Approved");
  await expect(approved.getByRole("heading", { level: 2 })).toHaveText("Approved 4");
  await expect(approved.locator(CARD)).toHaveCount(4);
  await expect(approved.getByText("2 overdue")).toBeVisible();

  const inProgress = column(page, "In progress");
  await expect(inProgress.getByRole("heading", { level: 2 })).toHaveText("In progress 1");
  await expect(inProgress.getByText("1 overdue")).toBeVisible();

  const resolved = column(page, "Resolved");
  await expect(resolved.getByRole("heading", { level: 2 })).toHaveText("Resolved 1");
  await expect(resolved.getByText(/\d+ overdue/)).toHaveCount(0);
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
  await expect(busy.getByText("Fix", { exact: true })).toHaveClass(/bg-secondary/); // the work type badge
  await expect(busy.getByText("RAKE Agent · Liam Carter", { exact: true })).toBeVisible();
  await expect(busy.getByText("P1 · Blocking", { exact: true })).toHaveClass(/border-primary/);
  await expect(busy.locator("time")).toHaveText(/^(now|\d+ [mhd])$/);
  const overdue = busy.getByText(/^Overdue · .*15 Sept?$/);
  await expect(overdue).toBeVisible();
  await expect(overdue).toHaveClass(/text-destructive/);
  await expect(busy.getByText("Has files")).toHaveCount(1);
  await expect(busy.getByText("New reply", { exact: true })).toBeVisible();
  await expect(busy.getByText("Flagged")).toHaveCount(0);

  // A card with a date far ahead says "Due", not red.
  const due = boardCard(page, world.due);
  const dueDate = due.getByText(/^Due .*15 June?$/);
  await expect(dueDate).toBeVisible();
  await expect(dueDate).not.toHaveClass(/text-destructive/);
  await expect(due.getByText(/^P2 · Major$/)).not.toHaveClass(/border-primary/);

  // A plain card has none of the extras.
  const plain = boardCard(page, world.plain);
  await expect(plain.getByText("Fix", { exact: true })).toHaveClass(/bg-secondary/);
  await expect(plain.getByText("RAKE Agent · Tom Nguyen", { exact: true })).toBeVisible();
  await expect(plain.getByText(/^P\d · /)).not.toHaveClass(/border-primary/);
  await expect(plain.getByText("Has files")).toHaveCount(0);
  await expect(plain.getByText("New reply", { exact: true })).toHaveCount(0);
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

// Moving cards. Each test raises its own items, so the world above (and the counts S12.03 checks) is left alone.
// Marc's five columns run past the right edge of a 1280 px window, so these
// tests use a 1920 px screen and every drag stays inside the window.
test.describe("moving cards", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  /** A card in a given column. */
  const cardIn = (page: Page, title: string, ref: string) => column(page, title).locator(CARD).filter({ hasText: new RegExp(`${ref}(?!\\d)`) });

  /** Raise an item as a staff member and, unless it should wait for approval, have Chris approve it. */
  async function item(team: Team, who: string, text: string, project: string, approve = true) {
    const ref = await raise(await team.as(who), text, IMPACT, project);
    if (approve) await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
    return ref;
  }

  /** Drag a card onto a column with the mouse: press on it, move past the 6 px it takes to pick it up, glide over, let go.
   *  `allowed` is whether the card's moves include that column: only then does it light up (D91). */
  async function drag(page: Page, ref: string, to: string, allowed = true) {
    const card = await boardCard(page, ref).boundingBox();
    const target = column(page, to);
    const box = await target.boundingBox();
    if (!card || !box) throw new Error(`${ref} or the ${to} column is not on the screen`);
    const [x, y] = [card.x + card.width / 2, card.y + card.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(80, box.height / 2), { steps: 20 });
    // The column lights up under the card where it can land; elsewhere it stays dimmed, as the person sees it.
    await expect(target).toHaveClass(allowed ? /ring-2/ : /opacity-60/);
    await page.mouse.up();
  }

  test("S12.05 Dragging an Approved card to In progress toasts '… moved to In progress' and ticks In progress on the submitter's tracker", async ({ page, signIn, team }) => {
    const ref = await item(team, "Liam", "The RAKE Agent calendar widget freezes my browser tab", "rake-agent");
    await signIn("Darlene");
    await gotoWork(page);
    await expect(cardIn(page, "Approved", ref)).toBeVisible();

    await drag(page, ref, "In progress");
    await expect(page.getByText(`${ref} moved to In progress`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "In progress", ref)).toBeVisible();
    await expect(cardIn(page, "Approved", ref)).toHaveCount(0);

    // The person who raised it sees the stepper move on: Planned done, In progress current.
    const liam = await team.as("Liam");
    await liam.goto(`/track/${ref}`);
    const stages = liam.getByRole("region", { name: "Progress" }).getByRole("listitem");
    await expect(stages.nth(1)).toContainText("Planned, done");
    await expect(stages.nth(2)).toContainText("In progress, current stage");
  });

  test("S12.06 Dragging an In progress card to Resolved opens a dialog that requires 'What was done'", async ({ page, signIn, team }) => {
    const ref = await item(team, "Aisha", "RAKE Agent citations point to the wrong policy clause", "rake-agent");
    await postJson(await team.as("Darlene"), `/console/items/${ref}/start`);
    await signIn("Darlene");
    await gotoWork(page);

    await drag(page, ref, "Resolved");
    const dialog = page.getByRole("dialog", { name: "Resolve" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("What was done")).toBeVisible();

    // Empty, it is refused and nothing moves.
    await dialog.getByRole("button", { name: "Resolve" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("What was done is needed.");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("What was done").fill("Pointed the citations at the current policy library");
    await dialog.getByRole("button", { name: "Resolve" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`${ref} resolved`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "Resolved", ref)).toBeVisible();
    await expect(cardIn(page, "In progress", ref)).toHaveCount(0);
  });

  test("S12.07 A Resolved card has no Fixed column to drag to; Chris's Close as fixed on its panel takes it off the board into the Archive's Fixed column", async ({ page, signIn, team }) => {
    const darlene = await team.as("Darlene");
    const ref = await item(team, "Tom", "RAKE Agent spell checker underlines Australian spelling", "rake-agent");
    await postJson(darlene, `/console/items/${ref}/start`);
    await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Added the Australian dictionary" });
    await signIn("Darlene");
    await gotoWork(page);

    // The board ends at Resolved.
    await expect(cardIn(page, "Resolved", ref)).toBeVisible();
    await expect(page.locator(`${COLUMN} h2`)).toHaveText([/^Approved \d+$/, /^In progress \d+$/, /^Resolved \d+$/]);

    // Tom confirms it, or the clock closes it; an Admin can close it for him with a reason (D92).
    await signIn("Chris");
    await page.goto(`/console?inbox=open&item=${ref}`);
    const panel = page.getByRole("dialog").filter({ hasText: ref });
    await moveTo(page, panel, "Close as fixed…");
    const dialog = page.getByRole("dialog", { name: "Close as fixed", exact: true });
    await expect(dialog.getByText("The person who raised it usually confirms the fix, or it closes by itself if they don't answer.", { exact: false })).toBeVisible();
    await dialog.getByLabel("Reason (only the Digital team sees it)").fill("Tom confirmed it in the team meeting");
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toHaveCount(0);

    // Gone from the board; the Archive's board has it under Fixed.
    await page.goto("/console?inbox=open");
    await expect(page.locator(CARD).filter({ hasText: new RegExp(`${ref}(?!\d)`) })).toHaveCount(0);
    await inboxTab(page, "Archive").click();
    await expect(inboxTab(page, "Archive")).toHaveAttribute("aria-selected", "true");
    await expect(cardIn(page, "Fixed", ref)).toBeVisible();
  });

  test("S12.08 As Marc, dragging an Awaiting approval card to In progress is refused and the card stays", async ({ page, signIn, team }) => {
    const ref = await item(team, "Grace", "Training Portal quiz timer resets when I switch tabs", "training-portal", false);
    await signIn("Marc");
    await gotoWork(page);
    await expect(cardIn(page, "Awaiting approval", ref)).toBeVisible();

    // Its moves are Approve and Close (D91), so In progress doesn't light up and the drop is refused.
    await drag(page, ref, "In progress", false);
    await expect(page.getByText(`${ref} can't move to In progress from Awaiting approval.`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "Awaiting approval", ref)).toBeVisible();
    await expect(cardIn(page, "In progress", ref)).toHaveCount(0);
  });

  test("S12.18 The row menu's Status and the board offer the panel's moves only: Darlene's Approved item gives Start work, Resolve and Close; Mario's drop on In progress is refused", async ({ page, signIn, team }) => {
    const ref = await item(team, "Grace", "RAKE Agent glossary search ignores capital letters", "rake-agent");
    const listMoves = async (who: Page) => {
      await who.goto("/console?inbox=open");
      await who.getByRole("radio", { name: "List" }).click();
      await who.getByRole("button", { name: `Actions for ${ref}` }).click();
      await who.getByRole("menuitem", { name: "Status" }).click();
      const items = await who.getByRole("menu").last().getByRole("menuitem").allInnerTexts();
      await who.keyboard.press("Escape");
      return items.map((i) => i.trim());
    };

    // Darlene has it: the same three moves in the row menu as in the panel's Status menu.
    await signIn("Darlene");
    expect(await listMoves(page)).toEqual(["Start work", "Resolve…", "Close…"]);
    await page.goto(`/console?inbox=open&item=${ref}`);
    expect(await statusMoves(page, page.getByRole("dialog").filter({ hasText: ref }))).toEqual(["Start work", "Resolve…", "Close…"]);
    // The other board tests expect Darlene's saved view to be Board.
    await page.request.put("/api/console/view", { data: { view: "board" } });

    // Mario doesn't hold it: Close only, and the board won't take it to In progress.
    await signIn("Mario");
    expect(await listMoves(page)).toEqual(["Close…"]);
    await page.getByRole("radio", { name: "Board" }).click();
    await expect(cardIn(page, "Approved", ref)).toBeVisible();
    await drag(page, ref, "In progress", false);
    await expect(page.getByText(`${ref} can't move to In progress from Approved.`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "Approved", ref)).toBeVisible();
  });

  test("S12.09 As Marc, dragging an Awaiting approval card to Approved approves it", async ({ page, signIn, team }) => {
    const ref = await item(team, "Rafael", "Training Portal course videos buffer forever on the VPN", "training-portal", false);
    await signIn("Marc");
    await gotoWork(page);
    await expect(cardIn(page, "Awaiting approval", ref)).toBeVisible();

    await drag(page, ref, "Approved");
    await expect(page.getByText(`${ref} approved`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "Approved", ref)).toBeVisible();
    await expect(cardIn(page, "Awaiting approval", ref)).toHaveCount(0);
  });

  test("S12.10 Moving a card with the keyboard (Tab, Space, arrows, Space) gives the same result as dragging", async ({ page, signIn, team }) => {
    const ref = await item(team, "Mei", "RAKE Agent keyboard shortcuts stopped working in Firefox", "rake-agent");
    await signIn("Darlene");
    await gotoWork(page);
    const card = boardCard(page, ref);
    await expect(cardIn(page, "Approved", ref)).toBeVisible();

    // Tab from the search box until the card itself has focus.
    await page.getByRole("textbox", { name: "Search", exact: true }).focus();
    for (let i = 0; i < 60 && !(await card.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(card).toBeFocused();

    // Space picks it up; each arrow press moves it 25 px, so press until In progress lights up; Space drops it.
    // The screen-reader announcement says it is held: "Picked up …", at once replaced by "… moved over … approved".
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: new RegExp(`^(Picked up draggable item|Draggable item) ${ref}\\b`) })).toBeAttached();
    const target = column(page, "In progress");
    for (let i = 0; i < 40 && !/ring-2/.test((await target.getAttribute("class")) ?? ""); i++) await page.keyboard.press("ArrowRight");
    await expect(target).toHaveClass(/ring-2/);
    await page.keyboard.press("Space");

    await expect(page.getByText(`${ref} moved to In progress`, { exact: true })).toBeVisible();
    await expect(cardIn(page, "In progress", ref)).toBeVisible();
    await expect(cardIn(page, "Approved", ref)).toHaveCount(0);
  });
});

test("S12.11 The chosen view (List) survives a reload and signing out and in; Mario, who never chose, gets Board", async ({ page, signIn }) => {
  const stillList = async () => {
    await expect(page.getByRole("columnheader", { name: "Ref" })).toBeVisible();
    await expect(viewButton(page, "List")).toHaveAttribute("aria-checked", "true");
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
  await expect(viewButton(page, "Board")).toHaveAttribute("aria-checked", "true");
  await expect(viewButton(page, "List")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("columnheader")).toHaveCount(0);
});

test("S12.12 Each inbox tab (Assigned to me, Triage, All open, Overdue, Archive) filters Board, List and Cards", async ({ page, signIn }) => {
  await signIn("Marc");
  const cards = await allCards(page);
  const inboxes = [
    { label: "Assigned to me", refs: refsOf(cards.filter((c) => c.assignee?.name === "Marc")) },
    {
      label: "Triage",
      refs: refsOf(cards.filter((c) => ["needs_review", "new"].includes(c.status) || (!c.assignee && OPEN.includes(c.status)))),
    },
    { label: "All open", refs: refsOf(cards.filter((c) => OPEN.includes(c.status))) },
    { label: "Overdue", refs: OVERDUE.map((key) => world[key]) },
    { label: "Archive", refs: refsOf(cards.filter((c) => CLOSED.includes(c.status))) },
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
    { label: "Project", option: "RAKE Agent", param: "project", value: "rake-agent", match: (c: Card) => c.project?.slug === "rake-agent" },
    { label: "Work type", option: "Improvement", param: "work_type", value: "improvement", match: (c: Card) => c.work_type === "improvement" },
    { label: "Category", option: "Bug", param: "category", value: "bug", match: (c: Card) => c.category === "bug" },
    { label: "Priority", option: "P2", param: "priority", value: "P2", match: (c: Card) => c.priority === "P2" },
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

  // One Filter button; each choice becomes a removable chip.
  const pick = async (label: string, option: string) => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  };
  const clear = (label: string) => page.getByRole("button", { name: `Remove ${label} filter`, exact: true }).click();
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
      await clear(f.label);
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
  await expect(page.getByText("Project: RAKE Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Priority: P2", { exact: true })).toBeVisible();
  await expectRefs(page, "Cards", refsOf(both));
});

// Outside the checklist (FINDINGS: the Work filters stayed empty with no message when the project list failed).
test("The console says so, and loads the filters on Try again, when the project list does not load", async ({ page, signIn }) => {
  await signIn("Marc");
  let failing = true;
  await page.route("**/api/projects", (route) => (failing ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));
  await page.goto("/console");
  const alert = page.getByRole("alert").filter({ hasText: "did not load" });
  await expect(alert).toBeVisible();

  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitem", { name: "Project", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "RAKE Agent" })).toBeVisible();
});

test("S12.14 List view has the columns Ref, Title, Project, Type, Priority, Stage, Assignee, Age and Expected by (red when overdue)", async ({ page, signIn }) => {
  await signIn("Darlene");
  await openWork(page, "List");
  await expect(page.getByRole("columnheader")).toHaveText(["Ref", "Title", "Project", "Type", "Priority", "Stage", "Assignee", "Age", "Expected by", "Actions"]);

  const overdue = page.getByRole("row").filter({ hasText: world.p1 });
  // Its submitter replied since Darlene last looked, so the title carries New reply (D82).
  await expect(overdue.getByRole("cell")).toHaveText([world.p1, `New reply${TEXT.p1}`, "RAKE Agent", "Fix", "P1 · Blocking", "Approved", "Darlene", /^(now|\d+ [mhd])$/, /15 Sep/, ""]);
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

test("S12.16 The Archive lists every ended item under how it ended; the Ended as filter and the search narrow it, and other inboxes have no such filter", async ({ page, signIn, team }) => {
  test.setTimeout(180_000);
  const [darlene, marc, chris] = await Promise.all(["Darlene", "Marc", "Chris"].map((name) => team.as(name)));
  const rake = async (who: string, text: string) => raise(await team.as(who), text, IMPACT, "rake-agent");
  const approved = async (who: string, text: string) => {
    const ref = await rake(who, text);
    await postJson(chris, `/console/items/${ref}/approve`);
    return ref;
  };

  const wontFix = await approved("Liam", "The RAKE Agent colour picker shows an error");
  await postJson(darlene, `/console/items/${wontFix}/close`, { reason: "Working as designed", ending: "wont_fix" });
  const notNeeded = await approved("Aisha", "The RAKE Agent font picker shows an error");
  await postJson(darlene, `/console/items/${notNeeded}/close`, { reason: "Replaced by the new theme", ending: "no_longer_needed" });
  const declined = await rake("Tom", "The RAKE Agent icon picker shows an error");
  await postJson(marc, `/console/items/${declined}/decline`, { reason: "Out of scope this quarter" });
  const original = await approved("Grace", "The RAKE Agent theme picker shows an error");
  const copy = await approved("Rafael", "The RAKE Agent theme chooser shows an error");
  await postJson(marc, `/console/items/${copy}/merge`, { into: original });
  const praise = await raise(await team.as("Mei"), "Thanks for the Training Portal update, works great");

  await signIn("Marc");
  const ended = refsOf((await allCards(page)).filter((c) => CLOSED.includes(c.status)));
  for (const ref of [wontFix, notNeeded, declined, copy, praise, world.closed]) expect(ended, ref).toContain(ref);
  expect(ended).not.toContain(original);

  // The list groups the ended items by how they ended; praise has no ending of its own.
  await openWork(page, "List", "?inbox=archive");
  await expectRefs(page, "List", ended);
  for (const group of ["Fixed", "Won't fix", "Duplicate", "Declined", "No longer needed", "Praise"]) {
    await expect(page.getByRole("row").filter({ hasText: new RegExp(`^${group} \\d+$`) }), group).toHaveCount(1);
  }
  await expect(page.getByRole("row").filter({ hasText: wontFix }).getByText("Won't fix", { exact: true })).toBeVisible();

  const pick = async (option: string) => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ended as", exact: true }).click();
    await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  };
  await pick("Won't fix");
  await expect(page).toHaveURL(/[?&]ending=wont_fix(&|$)/);
  await expectRefs(page, "List", [wontFix]);
  await pick("Praise");
  await expect(page).toHaveURL(/[?&]ending=acknowledged(&|$)/);
  await expectRefs(page, "List", [praise]);
  await page.getByRole("button", { name: "Remove Ended as filter", exact: true }).click();
  await expectRefs(page, "List", ended);

  // Search works inside the Archive.
  const box = page.getByRole("textbox", { name: "Search", exact: true });
  await box.fill("icon picker");
  await box.press("Enter");
  await expectRefs(page, "List", [declined]);

  // Only the Archive has the filter; leaving it drops the choice.
  await pick("Declined");
  await page.getByRole("tab", { name: /^All open/ }).click();
  await expect(page).not.toHaveURL(/ending=/);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Ended as", exact: true })).toHaveCount(0);
});

test("S12.17 A Resolved card, its list row and the Archive show the priority in grey with its icon and words", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raise(await team.as("Liam"), "The RAKE Agent print preview shows an error when I open it", IMPACT, "rake-agent");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await postJson(page, `/console/items/${ref}/start`);
  const priority = (where: Locator) => where.getByText("P2 · Major", { exact: true });

  await openWork(page, "Board");
  await expect(priority(boardCard(page, ref))).toHaveClass(/text-warning/); // still open: it keeps its colour
  await postJson(page, `/console/items/${ref}/resolve`, { body: "Fixed: print preview opens again." });
  await reloadWork(page);
  await expect(priority(boardCard(page, ref))).toHaveClass(/text-muted-foreground/);
  await expect(priority(boardCard(page, ref)).locator("svg")).toHaveCount(1);

  await openWork(page, "List");
  await expect(priority(page.getByRole("row", { name: new RegExp(ref) }))).toHaveClass(/text-muted-foreground/);
  await postJson(await team.as("Liam"), `/feedback/${ref}/fixed`); // Liam confirms the fix (D92)
  await openWork(page, "List", "?inbox=archive");
  await expect(priority(page.getByRole("row", { name: new RegExp(ref) }))).toHaveClass(/text-muted-foreground/);
  await openWork(page, "Board");
});
