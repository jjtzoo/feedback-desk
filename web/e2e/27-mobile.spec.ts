import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";

// Manual checklist section 27: phone width (375 x 812). Items 1 to 5 are still checked by hand.

test.beforeAll(resetDatabase);

test.use({ viewport: { width: 375, height: 812 } });

const guide = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Guide", exact: true });
/** A tour card that explains a step (a dialog), by its title. */
const tourCard = (page: Page, title: string) => page.getByRole("dialog", { name: title, exact: true });
/** The small card that asks for a click. */
const clickCard = (page: Page) => page.getByRole("status").filter({ hasText: /Step \d+ of \d+\./ });
const tryCard = (page: Page) => page.getByRole("status").filter({ hasText: "Try it out" });
const spotlight = (page: Page) => page.locator('div[aria-hidden="true"][style*="9999px"]');
const press = (card: Locator, name: string) => card.getByRole("button", { name, exact: true }).click();

/** The spotlight sits around the control (it is drawn a few pixels bigger). */
async function expectHighlighted(page: Page, control: Locator) {
  await expect(async () => {
    const [ring, box] = [(await spotlight(page).boundingBox())!, (await control.boundingBox())!];
    expect(ring.x).toBeLessThanOrEqual(box.x);
    expect(ring.y).toBeLessThanOrEqual(box.y);
    expect(ring.x + ring.width).toBeGreaterThanOrEqual(box.x + box.width);
    expect(ring.y + ring.height).toBeGreaterThanOrEqual(box.y + box.height);
  }).toPass();
}

test("S27.06 The console Guide at phone width points at Open menu, then highlights the item once the menu is open, and no step dead-ends", async ({ page, signIn }) => {
  await signIn("Chris");
  await page.goto("/console");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  await guide(page).click();

  await press(tourCard(page, "Work"), "OK");
  await expect(clickCard(page)).toContainText("Open the highlighted menu first.");
  await expectHighlighted(page, menu);

  await menu.click();
  const work = page.getByRole("dialog", { name: "Console" }).getByRole("link", { name: "Work", exact: true });
  await expect(clickCard(page)).toContainText("Click the highlighted control to try it.");
  await expectHighlighted(page, work);
  await work.click();
  await press(tryCard(page), "Next");

  // Every other step either shows its control or says where it is, and moves on.
  for (const title of ["Approvals", "Channels", "Releases", "Dashboard", "Admin"]) {
    await press(tourCard(page, title), "OK");
    await expect(clickCard(page)).toContainText("Open the highlighted menu first.");
    await press(clickCard(page), "Skip this step");
  }
  await press(tourCard(page, "Smoke Signal home"), "Next");
  await press(tourCard(page, "That's it"), "Done");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("S27.07 The staff Guide at phone width highlights every control it asks you to click", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await guide(page).click();

  const steps: [string, "OK" | "Next" | "Done"][] = [
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
  for (const [title, main] of steps) {
    await press(tourCard(page, title), main);
    if (main !== "OK") continue;
    await expect(clickCard(page)).toContainText("Click the highlighted control to try it.");
    await press(clickCard(page), "Skip this step");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("on a touch phone", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("S27.08 The chat's app cards sit two to a row with no sideways scroll, and the paperclip, Take a photo, box and Send share one line", async ({ page, signIn }) => {
    await signIn("Liam");
    await page.goto("/chat");
    const cards = page.getByRole("region", { name: /Which tool is it about/ }).getByRole("button");
    await expect(cards.first()).toBeVisible();
    const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())!));
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(c.y).toBeGreaterThan(a.y + a.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    const row = [page.getByRole("button", { name: /Attach a file/ }), page.getByRole("button", { name: "Take a photo" }), page.getByLabel("Your message"), page.getByRole("button", { name: "Send" })];
    const boxes = await Promise.all(row.map(async (control) => (await control.boundingBox())!));
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
      expect(boxes[i].y).toBeLessThan(boxes[0].y + boxes[0].height);
    }
    expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(375);
  });
});
