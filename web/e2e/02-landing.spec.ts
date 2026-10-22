import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { raiseBug } from "./helpers";

// Manual checklist section 2: the staff landing page (/). The Guide tour items are a Stage 3 hard case.

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

/** The "Already know which tool?" menu, opened. The tools come from the API after the page shows. */
async function openToolMenu(page: Page) {
  const menu = page.getByRole("combobox", { name: "Already know which tool?" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("listbox")).toBeVisible();
}

test("S02.01 As Mario, / shows the red hero band 'Tell us what's not working, or what could work better', a 'Hi Mario' line above it and a Start a conversation button", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);

  const hero = page.locator("section.bg-primary");
  await expect(hero).toBeVisible();
  const heading = hero.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Tell us what's not working, or what could work better");

  const hi = hero.getByText("Hi Mario", { exact: true });
  await expect(hi).toBeVisible();
  const hiBox = await hi.boundingBox();
  const headingBox = await heading.boundingBox();
  expect(hiBox!.y + hiBox!.height).toBeLessThanOrEqual(headingBox!.y);

  const start = hero.getByRole("link", { name: /Start a conversation/ });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute("href", "/chat");
});

test("S02.02 The Guide's first card explains step 1, and steps with something to click show OK instead of Next", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.03 OK on 'Give feedback' shrinks the card to 'Click Give feedback', pulses that control and dims the rest", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.04 While the small card says 'Click Give feedback', clicking anywhere not highlighted does nothing", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.05 Clicking the highlighted control does its normal job, the dimming goes and a 'Try it out' card appears", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.06 On the 'Try it out' card, Next shows the next step's card", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.07 Skip this step moves on, Skip tour ends the tour, Esc ends it except during 'Try it out'", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.08 As Mario the console's Guide runs Work, Channels, Releases, Dashboard, then Smoke Signal home; Chris also gets Approvals and Admin", async () => {
  test.skip(true, "Stage 3: Guide tour");
});

test("S02.09 The 'I need access' card opens /chat?start=access with 'I need access to ' in the box and the cursor in it", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);
  await page.getByRole("link", { name: /I need access/ }).click();

  await expect(page).toHaveURL(/\/chat\?start=access$/);
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
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
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
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
    await expect(row).toContainText("Received, waiting for approval");
  }
  await expect(recent.getByText(items[0][1])).toHaveCount(0);

  await recent.getByRole("link", { name: /View all/ }).click();
  await expect(page).toHaveURL(/\/my$/);

  // Mei has sent nothing: a short message instead of a list.
  const mei = await team.as("Mei");
  await openLanding(mei);
  const none = mei.getByRole("region", { name: "Your recent feedback" });
  await expect(none.getByText(/No feedback submitted yet/)).toBeVisible();
  await expect(none.getByRole("listitem")).toHaveCount(0);
  await expect(none.getByRole("link", { name: /View all/ })).toBeVisible();
});

test("S02.14 'How it works' shows three steps, including 'Nothing is submitted until you select Confirm'", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);

  const how = page.getByRole("region", { name: "How it works" });
  await expect(how).toBeVisible();
  const steps = how.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toContainText("Nothing is submitted until you select Confirm.");
});

test("S02.15 The footer says chats are processed by Gemini and passwords, card numbers and tax file numbers are removed before saving", async ({ page, signIn }) => {
  await signIn("Mario");
  await openLanding(page);

  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText(/chats are processed by Google's Gemini model/);
  await expect(footer).toContainText(/Passwords, card numbers and tax file numbers are removed before anything is saved/);
});
