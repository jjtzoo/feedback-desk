import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, raiseBug } from "./helpers";

// Manual checklist section 25: nothing is saved without the Confirm button.

test.beforeAll(resetDatabase);

const EXPECTED = "I expected it to open but got a blank screen";

const card = (page: Page) => page.getByRole("region", { name: "Your feedback" });
/** The value next to a label on the card (Tool, Type, Title, Summary, Priority). */
const field = (page: Page, label: string) => card(page).locator(`dt:text-is("${label}") + dd`);

/** Describe it, choose how much it affects the person, say what was expected: the confirm card shows. */
async function reachCard(page: Page, description: string, impact = "Slowing me down") {
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
  await chatSay(page, description);
  await page.getByRole("button", { name: impact, exact: true }).click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, EXPECTED);
  await expect(card(page)).toBeVisible();
}

/** The person's own items, as the API lists them. */
const mine = (page: Page) => getJson<{ reference: string }[]>(page, "/my/feedback");

test.describe("25. Nothing saved without Confirm", () => {
  test("S25.01 closing the tab at the confirm card leaves no new item in the console", async ({ page, signIn, team }) => {
    await signIn("Liam");
    // A control item that is saved, so the console list is read once it has loaded; both titles carry "zq25".
    await raiseBug(page, "rake-agent", "RAKE Agent export fails with an error zq25ctl");
    const before = (await mine(page)).length;
    await reachCard(page, "The Flipbook shows an error zq25tab when I open a brochure");
    await expect(field(page, "Title")).toContainText("zq25tab");

    const context = page.context();
    await page.close();

    const marc = await team.as("Marc");
    await marc.goto("/console?inbox=open&q=zq25");
    await marc.getByRole("button", { name: "Cards", exact: true }).click();
    await expect(marc.getByRole("button", { name: /zq25ctl/ })).toBeVisible();
    await expect(marc.getByRole("button", { name: /zq25tab/ })).toHaveCount(0);
    const found = await getJson<{ total: number; items: { title: string }[] }>(marc, "/console/items?inbox=all&q=zq25tab");
    expect(found.total).toBe(0);

    // Nothing under the person's own name either (a fresh tab in the same signed-in window).
    const again = await context.newPage();
    expect(await mine(again)).toHaveLength(before);
  });

  test("S25.02 typing 'submit it' or 'send it' at the card asks for Confirm and saves no item", async ({ page, signIn, team }) => {
    await signIn("Aisha");
    await reachCard(page, "The Financial Platform shows an error zq25say when I open an invoice");
    const before = (await mine(page)).length;
    const nudge = page.getByText("Press Confirm on the summary to send it, or tell me what to change.");

    await chatSay(page, "submit it");
    await expect(nudge).toHaveCount(1);
    await expect(card(page)).toBeVisible();
    await chatSay(page, "send it");
    await expect(nudge).toHaveCount(2);
    await expect(card(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: /Sent\. Your reference is/ })).toHaveCount(0);

    expect(await mine(page)).toHaveLength(before);
    const marc = await team.as("Marc");
    expect((await getJson<{ total: number }>(marc, "/console/items?inbox=all&q=zq25say")).total).toBe(0);
  });

  test("S25.03 after Change, the saved item matches the new card, not the old one", async ({ page, signIn }) => {
    await signIn("Tom");
    // Old card: RAKE Agent, Nice-to-have. The new card: Training Portal, Major.
    await reachCard(page, "The RAKE Agent shows an error when I open a report", "Nice-to-have");
    await expect(field(page, "Tool")).toHaveText("RAKE Agent");
    await expect(field(page, "Priority")).toHaveText("Nice-to-have");

    await page.getByRole("button", { name: "Change" }).click();
    await expect(page.getByText("No worries. What should I change?")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await chatSay(page, "it's about the Training Portal");
    await expect(field(page, "Tool")).toHaveText("Training Portal");
    await page.getByRole("button", { name: "Change" }).click();
    await expect(card(page)).toHaveCount(0);
    await chatSay(page, "make it P2");
    await expect(field(page, "Tool")).toHaveText("Training Portal");
    await expect(field(page, "Priority")).toHaveText("Major");

    await page.getByRole("button", { name: "Confirm" }).click();
    const heading = page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
    await expect(heading).toBeVisible();
    const ref = (await heading.innerText()).match(/FB-\d{4}/)![0];

    await page.getByRole("link", { name: /Track it/ }).click();
    await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
    const band = page.getByRole("heading", { level: 1 }).locator("..");
    await expect(band).toContainText("Training Portal · Bug");
    await expect(band).not.toContainText("RAKE Agent");
    const sent = page.getByRole("region", { name: "What you sent" });
    await expect(sent).toContainText("Major");
    await expect(sent).not.toContainText("Nice-to-have");
  });
});
