import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { raiseBug } from "./helpers";

// Manual checklist section 2: the staff landing page (/) and the Guide tour.

test.beforeAll(resetDatabase);

// The 15 brief projects as the seed lists them, by group (backend/seed/projects.yaml).
const PLATFORMS = [
  "IT Asset",
  "Staff Admin Portal",
  "Training Portal",
  "CPD Tracker",
  "Financial Platform",
  "REDADAIR Workflow Atlas",
  "ADAIR EPM Portal",
  "Flipbook",
  "FPOWS Portal",
  "AFSS Portal",
  "GoFormz Extension Portal",
];
const AGENTS = ["Agents Platform (REDADAIR Helpers)", "RAKE Agent", "Fire Safety Blog Agent"];
const OTHER = ["Intranet site itself"];

const sortedNames = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b));

async function openLanding(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const banner = (page: Page) => page.getByRole("banner");
const guide = (page: Page) => banner(page).getByRole("button", { name: "Guide", exact: true });
/** A tour card that explains a step (a dialog), by its title. */
const tourCard = (page: Page, title: string) => page.getByRole("dialog", { name: title, exact: true });
/** The small card that asks for a click, by its words. */
const smallCard = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const tryCard = (page: Page) => page.getByRole("status").filter({ hasText: "Try it out" });
const spotlight = (page: Page) => page.locator('div[aria-hidden="true"][style*="9999px"]');
const pulse = (page: Page) => page.locator('[class~="motion-safe:animate-pulse"]');
const fullDim = (page: Page) => page.locator('[class~="bg-black/55"]');
const navChat = (page: Page) => banner(page).getByRole("link", { name: "Give feedback", exact: true });
const press = (card: Locator, name: string) => card.getByRole("button", { name, exact: true }).click();

/** The landing page's Guide, up to the card that explains step 3 (Give feedback). */
async function toGiveFeedback(page: Page) {
  await openLanding(page);
  await guide(page).click();
  await press(tourCard(page, "Welcome to Smoke Signal"), "Next");
  await press(tourCard(page, "Start here"), "Next");
  await expect(tourCard(page, "Give feedback")).toBeVisible();
}

/** On to step 3's "Try it out" card, by clicking Give feedback as asked. */
async function toTryGiveFeedback(page: Page) {
  await toGiveFeedback(page);
  await press(tourCard(page, "Give feedback"), "OK");
  await expect(smallCard(page, "Click Give feedback")).toBeVisible();
  await navChat(page).click();
  await expect(tryCard(page)).toBeVisible();
}

async function expectNoTour(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /Step \d+ of \d+/ })).toHaveCount(0);
  await expect(spotlight(page)).toHaveCount(0);
  await expect(fullDim(page)).toHaveCount(0);
}

/** The console's Guide, every step in order: its title and main button; each click step is skipped. */
async function runConsoleGuide(page: Page, steps: [string, "OK" | "Next" | "Done"][]) {
  await page.goto("/console");
  await expect(page.getByRole("navigation", { name: "Console" })).toBeVisible();
  await guide(page).click();
  for (const [i, [title, main]] of steps.entries()) {
    const card = tourCard(page, title);
    await expect(card).toContainText(`Step ${i + 1} of ${steps.length}`);
    await expect(card.getByRole("button", { name: main, exact: true })).toBeVisible();
    await press(card, main);
    if (main === "OK") await press(smallCard(page, `Click ${title}`), "Skip this step");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** The "Already know which tool?" menu, opened. The tools come from the API after the page shows. */
async function openToolMenu(page: Page) {
  const menu = page.getByRole("combobox", { name: "Already know which tool?" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("listbox")).toBeVisible();
}

test("S02.01 As Mario, / shows the red band 'What can we help you with?', a 'Hi Mario' line above it and a Give feedback button", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);

  const hero = page.locator("section.bg-primary");
  await expect(hero).toBeVisible();
  const heading = hero.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("What can we help you with?");

  const hi = hero.getByText("Hi Mario", { exact: true });
  await expect(hi).toBeVisible();
  const hiBox = await hi.boundingBox();
  const headingBox = await heading.boundingBox();
  expect(hiBox!.y + hiBox!.height).toBeLessThanOrEqual(headingBox!.y);

  const start = hero.getByRole("link", { name: /Give feedback/ });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute("href", "/chat");
});

test("S02.02 The Guide's first card explains step 1, and steps with something to click show OK instead of Next", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);
  const button = guide(page);
  await expect(button.locator("svg.lucide-circle-question-mark")).toHaveCount(1);
  expect((await button.boundingBox())!.x).toBeGreaterThan(page.viewportSize()!.width / 2);

  await button.click();
  const welcome = tourCard(page, "Welcome to Smoke Signal");
  await expect(welcome).toContainText("Step 1 of 9");
  await expect(welcome).toContainText("Report a problem, ask for access or suggest an idea for any intranet platform or agent.");
  await expect(fullDim(page)).toHaveCount(1); // nothing to point at, so the card sits in the middle

  const steps: [string, "Next" | "OK" | "Done"][] = [
    ["Welcome to Smoke Signal", "Next"],
    ["Start here", "Next"],
    ["Give feedback", "OK"],
    ["My feedback", "OK"],
    ["Updates", "OK"],
    ["Fixes and updates", "OK"],
    ["Your account", "OK"],
    ["Your console", "Next"],
    ["That's it", "Done"],
  ];
  for (const [i, [title, main]] of steps.entries()) {
    const card = tourCard(page, title);
    await expect(card).toContainText(`Step ${i + 1} of 9`);
    for (const other of ["Next", "OK", "Done"].filter((name) => name !== main)) {
      await expect(card.getByRole("button", { name: other, exact: true })).toHaveCount(0);
    }
    await press(card, main);
    if (main === "OK") await press(smallCard(page, "Skip this step"), "Skip this step");
  }
  await expectNoTour(page);
});

test("S02.03 OK on 'Give feedback' shrinks the card to 'Click Give feedback', pulses that control and dims the rest", async ({ page, signIn }) => {
  await signIn("Mario");
  await toGiveFeedback(page);
  const introBox = (await tourCard(page, "Give feedback").boundingBox())!;
  await press(tourCard(page, "Give feedback"), "OK");

  const card = smallCard(page, "Click Give feedback");
  await expect(card).toContainText("Step 3 of 9. Click the highlighted control to try it.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await card.boundingBox())!.height).toBeLessThan(introBox.height);

  await expect(pulse(page)).toHaveCount(1);
  await expect(pulse(page)).toHaveCSS("animation-name", "pulse");
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
  expect(await pulse(page).evaluate((el) => getComputedStyle(el).getPropertyValue("--tw-ring-color"))).toContain(primary);
  // A solid 4 px primary ring round the control, then the dimming over the rest of the page.
  await expect(spotlight(page)).toHaveCSS("box-shadow", /^rgb\(\d+, \d+, \d+\) 0px 0px 0px 4px, rgba\(0, 0, 0, 0\.55\) 0px 0px 0px 9999px$/);

  // The spotlight is the control with 6 px around it; it animates into place.
  await expect(async () => {
    const hole = (await spotlight(page).boundingBox())!;
    const target = (await navChat(page).boundingBox())!;
    expect(Math.abs(hole.x - (target.x - 6))).toBeLessThanOrEqual(1);
    expect(Math.abs(hole.y - (target.y - 6))).toBeLessThanOrEqual(1);
    expect(Math.abs(hole.width - (target.width + 12))).toBeLessThanOrEqual(1);
    expect(Math.abs(hole.height - (target.height + 12))).toBeLessThanOrEqual(1);
  }).toPass();
});

test("S02.04 While the small card says 'Click Give feedback', clicking anywhere not highlighted does nothing", async ({ page, signIn }) => {
  await signIn("Mario");
  await toGiveFeedback(page);
  await press(tourCard(page, "Give feedback"), "OK");
  const card = smallCard(page, "Click Give feedback");
  await expect(card).toBeVisible();
  const before = await page.evaluate(() => history.length);

  const header = banner(page);
  for (const name of ["My feedback", "Fixes and updates", "Console"]) await header.getByRole("link", { name, exact: true }).click();
  await header.getByRole("button", { name: /^Notifications/ }).click();
  await header.getByRole("button", { name: "Account: Mario" }).click();

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/:3100\/$/);
  await expect(card).toBeVisible();

  // The highlighted control still works, and it is the only navigation there was.
  await navChat(page).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
});

test("S02.05 Clicking the highlighted control does its normal job, the dimming goes and a 'Try it out' card appears", async ({ page, signIn }) => {
  await signIn("Mario");
  await toGiveFeedback(page);
  await press(tourCard(page, "Give feedback"), "OK");
  await expect(smallCard(page, "Click Give feedback")).toBeVisible();
  await navChat(page).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText(/I'm Sig/)).toBeVisible();
  const card = tryCard(page);
  await expect(card).toContainText("Step 3 of 9. Have a look at Give feedback, then press Next to carry on.");
  await expect(spotlight(page)).toHaveCount(0);
  await expect(fullDim(page)).toHaveCount(0);
  await expect(pulse(page)).toHaveCount(0);

  // Bottom right, 16 px from the edges.
  const box = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(viewport.width - (box.x + box.width))).toBe(16);
  expect(Math.round(viewport.height - (box.y + box.height))).toBe(16);

  // The page is free to use, and the tour waits.
  await banner(page).getByRole("link", { name: "Fixes and updates", exact: true }).click();
  await expect(page).toHaveURL(/\/whats-new$/);
  await expect(card).toBeVisible();
});

test("S02.06 On the 'Try it out' card, Next shows the next step's card", async ({ page, signIn }) => {
  await signIn("Mario");
  await toTryGiveFeedback(page);
  await press(tryCard(page), "Next");

  const card = tourCard(page, "My feedback");
  await expect(card).toContainText("Step 4 of 9");
  await expect(card.getByRole("button", { name: "OK", exact: true })).toBeVisible();
  await expect(tryCard(page)).toHaveCount(0);
});

test("S02.07 Skip this step moves on, Skip tour ends the tour, Esc ends it except during 'Try it out'", async ({ page, signIn }) => {
  await signIn("Mario");

  // Skip this step, then Skip tour.
  await toGiveFeedback(page);
  await press(tourCard(page, "Give feedback"), "OK");
  await press(smallCard(page, "Skip this step"), "Skip this step");
  const next = tourCard(page, "My feedback");
  await expect(next).toContainText("Step 4 of 9");
  expect(new URL(page.url()).pathname).toBe("/");
  await press(next, "Skip tour");
  await expectNoTour(page);

  // Esc on an explaining card, and on the small card.
  await guide(page).click();
  await expect(tourCard(page, "Welcome to Smoke Signal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoTour(page);
  await toGiveFeedback(page);
  await press(tourCard(page, "Give feedback"), "OK");
  await expect(smallCard(page, "Click Give feedback")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoTour(page);

  // Esc during "Try it out" closes the open popover only.
  await guide(page).click();
  await press(tourCard(page, "Welcome to Smoke Signal"), "Next");
  await press(tourCard(page, "Start here"), "Next");
  for (const title of ["Give feedback", "My feedback"]) {
    await press(tourCard(page, title), "OK");
    await press(smallCard(page, "Skip this step"), "Skip this step");
  }
  await press(tourCard(page, "Updates"), "OK");
  await expect(smallCard(page, "Click the bell")).toBeVisible();
  await banner(page).getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Notifications");
  await expect(tryCard(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tryCard(page)).toBeVisible();
  await press(tryCard(page), "Next");
  await expect(tourCard(page, "Fixes and updates")).toContainText("Step 6 of 9");
});

test("S02.08 As Mario the console's Guide runs Work, Channels, Releases, Dashboard, then Smoke Signal home; Chris also gets Approvals and Admin", async ({ page, signIn, team }) => {
  await signIn("Mario");
  await runConsoleGuide(page, [
    ["Work", "OK"],
    ["Channels", "OK"],
    ["Releases", "OK"],
    ["Dashboard", "OK"],
    ["Smoke Signal home", "Next"],
    ["That's it", "Done"],
  ]);
  await runConsoleGuide(await team.as("Chris"), [
    ["Work", "OK"],
    ["Approvals", "OK"],
    ["Channels", "OK"],
    ["Releases", "OK"],
    ["Dashboard", "OK"],
    ["Admin", "OK"],
    ["Smoke Signal home", "Next"],
    ["That's it", "Done"],
  ]);
});

test("S02.09 The 'I need access' card opens /chat?start=access with 'I need access to ' in the box and the cursor in it", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);
  await page.getByRole("link", { name: /I need access/ }).click();

  await expect(page).toHaveURL(/\/chat\?start=access$/);
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  const box = page.getByLabel("Your message");
  await expect(box).toHaveValue("I need access to ");
  await expect(box).toBeFocused();
});

test("S02.10 'Already know which tool?' lists the 15 brief projects under Platforms, Agents and Other", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);
  await openToolMenu(page);

  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("option")).toHaveCount(15);
  for (const [group, names] of [
    ["Platforms", PLATFORMS],
    ["Agents", AGENTS],
    ["Other", OTHER],
  ] as const) {
    const options = listbox.getByRole("group", { name: group }).getByRole("option");
    await expect(options).toHaveCount(names.length);
    expect(sortedNames(await options.allTextContents())).toEqual(sortedNames(names));
  }
});

test("S02.11 Choosing RAKE Agent there opens /chat?project=rake-agent with RAKE Agent selected", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);
  await openToolMenu(page);
  await page.getByRole("option", { name: "RAKE Agent", exact: true }).click();

  await expect(page).toHaveURL(/\/chat\?project=rake-agent$/);
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  // The chat shows the chosen tool as an "About ..." chip beside the message box.
  await expect(page.getByText("About RAKE Agent", { exact: true })).toBeVisible();
});

test("S02.12 Opening /?project=rake-agent redirects to /chat?project=rake-agent", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/?project=rake-agent");

  await expect(page).toHaveURL(/\/chat\?project=rake-agent$/);
  await expect(page.getByText("About RAKE Agent", { exact: true })).toBeVisible();
});

test("S02.13 'Your recent feedback' shows your latest 3 items with their stage, 'View all' goes to /my, and a short message when there are none", async ({ page, signIn, team }) => {
  await signIn("Mario");
  // Four items on four tools, oldest first, so "up to 3 of the latest" leaves the first one out.
  const items = [
    ["rake-agent", "RAKE Agent export report fails with an error"],
    ["it-asset", "IT Asset list shows an error when I open it"],
    ["staff-admin-portal", "Staff Admin Portal shows an error on my timesheet"],
    ["flipbook", "Flipbook shows an error when I open a brochure"],
  ] as const;
  for (const [project, title] of items) await raiseBug(page, project, title);

  await openLanding(page);
  const recent = page.getByRole("region", { name: "Your recent feedback" });
  const rows = recent.locator("ul a");
  await expect(rows).toHaveCount(3);
  // Newest first, each with its FB reference and where it stands (the landing shows the status wording).
  await expect(rows).toContainText([items[3][1], items[2][1], items[1][1]]);
  for (const row of await rows.all()) {
    await expect(row).toContainText(/FB-\d{4}/);
    await expect(row).toContainText("Under review");
  }
  await expect(recent.getByText(items[0][1])).toHaveCount(0);

  await recent.getByRole("link", { name: /View all/ }).click();
  await expect(page).toHaveURL(/\/my$/);

  // Mei has sent nothing: a short message instead of a list.
  const mei = await team.as("Mei");
  await openLanding(mei);
  const none = mei.getByRole("region", { name: "Your recent feedback" });
  await expect(none.getByText(/Nothing here yet/)).toBeVisible();
  await expect(none.getByRole("listitem")).toHaveCount(0);
  await expect(none.getByRole("link", { name: /View all/ })).toBeVisible();
});

test("S02.14 'How it works' shows three steps, including 'Nothing is sent until you select Confirm'", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);

  const how = page.getByRole("region", { name: "How it works" });
  await expect(how).toBeVisible();
  const steps = how.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toContainText("Nothing is sent until you select Confirm.");
});
