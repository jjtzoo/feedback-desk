import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson } from "./helpers";

// Manual checklist section 22: AI usage and spend limits (D36).
//
// The browser tests run the scripted stub model, which reports no token counts, and the stub embeddings are
// never recorded, so nothing in this database ever writes a usage row. Every person is at 0 % of the
// allowance and the AI usage panel shows zeros. The spend limits come from the API's settings (300,000
// tokens a person a day, A$5 a day, A$60 a month unless the environment says otherwise) and a test must not
// change them. Items that need usage or a limit to be reached are therefore skipped with the setting they need.

test.beforeAll(resetDatabase);

type Usage = { people: unknown[] };

const panel = (page: Page) => page.getByRole("region", { name: "AI usage" });
/** The value under a label in the panel's totals (Model calls today, Tokens today, Cost per item (30 days)). */
const total = (page: Page, label: string) => panel(page).locator(`dt:text-is("${label}") + dd`).first();

/** The dashboard, waited on until the AI usage panel (it loads after the rest of the page) has drawn. */
async function openPanel(page: Page) {
  await page.goto("/console/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(panel(page)).toBeVisible();
}

test("S22.01 Open /chat: under the box, 'Today's assistant allowance: N% used' with a meter", async ({ page, signIn }) => {
  test.fail(true, "Known bug: the allowance line and meter stay hidden until half is used, so at 0 % nothing shows under the box (web/src/components/chat/usage-meter.tsx returns null below 50 %); the 'hidden when the limit is 0' half is not reachable, the test API fixes the limit");
  await signIn("Aisha");
  const allowance = page.waitForResponse((r) => r.url().includes("/api/usage/me"));
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
  // The person has an allowance to show (a limit above 0), and the answer has arrived, so what is checked is the screen.
  const mine = await (await allowance).json();
  expect(mine.limit_tokens).toBeGreaterThan(0);
  await expect(page.getByText(/Today's assistant allowance: \d+% used/)).toBeVisible();
  await expect(page.getByRole("meter", { name: "Today's assistant allowance used" })).toBeVisible();
});

test("S22.02 At 80 % or more the line turns amber with a warning icon and 'The form still works if it runs out.'", async () => {
  test.skip(true, "Not automated: needs 80 % of the per-person daily limit used, and the stub model records no tokens (it needs Gemini token counts or a low DAILY_TOKENS_PER_USER)");
});

test("S22.03 At the personal limit a new chat opens the backup form with \"You've used today's allowance with Sig. It resets tomorrow.\"", async () => {
  test.skip(true, "Not automated: needs the per-person limit reached (DAILY_TOKENS_PER_USER set low, and chat tokens recorded, which the stub does not do)");
});

test("S22.04 At the daily or monthly budget a new chat opens the backup form with 'Sig is paused for today to keep costs in check.'", async () => {
  test.skip(true, "Not automated: needs DAILY_BUDGET_AUD or MONTHLY_BUDGET_AUD reached (a low budget, and cost recorded, which the stub does not do)");
});

test("S22.05 Reaching a limit mid-chat: the backup form takes over with your text kept, and an existing confirm card can still be confirmed", async () => {
  test.skip(true, "Not automated: needs a limit reached while a chat is open (a low DAILY_TOKENS_PER_USER or budget, and usage recorded, which the stub does not do)");
});

test("S22.06 An Admin's AI usage panel: today and this month against the budgets, 14 days of history, cost per item against A$0.05", async ({ page, signIn }) => {
  // The top-users table (and its limit-reached flag) is part of this item, but it lists only people who have
  // used the model today, and the stub leaves no usage. It is not asserted here.
  await signIn("Marc");
  await openPanel(page);
  const p = panel(page);

  await expect(p.getByText(/Per-person limit: .+ tokens a day\./)).toBeVisible();

  // Today and this month, each with its spend against its AUD budget and a meter.
  await expect(p.locator("p").filter({ hasText: /^Today/ })).toHaveText(/^TodayA\$\d+\.\d+ of A\$\d+\.\d\d$/);
  await expect(p.locator("p").filter({ hasText: /^This month/ })).toHaveText(/^This monthA\$\d+\.\d+ of A\$\d+\.\d\d$/);
  await expect(p.getByRole("meter", { name: "Today spend" })).toBeVisible();
  await expect(p.getByRole("meter", { name: "This month spend" })).toBeVisible();

  // Calls and tokens today, and the cost per item next to its target.
  await expect(total(page, "Model calls today")).toHaveText(/^\d+$/);
  await expect(total(page, "Tokens today")).toHaveText(/^\d+(\.\d)?[kM]?$/);
  await expect(total(page, "Cost per item (30 days)")).toHaveText(/^(–|A\$\d+\.\d+)$/);
  await expect(p.getByText("Target: under A$0.05")).toBeVisible();

  // Fourteen days of history, one bar a day.
  await expect(p.getByRole("heading", { name: "Last 14 days" })).toBeVisible();
  const history = p.getByRole("img", { name: /Daily AI spend for the last 14 days/ });
  await expect(history).toBeVisible();
  await expect(history.locator(":scope > div")).toHaveCount(14);
});

test("S22.07 As Darlene the AI usage panel shows totals, but no per-person rows", async ({ page, signIn }) => {
  // With no usage recorded, an Admin would not see rows either (the stub writes none), so what this can prove is
  // that Darlene gets the panel and its totals and the API sends her no people; the backend test covers the rows.
  await signIn("Darlene");
  await openPanel(page);
  const p = panel(page);

  await expect(p.locator("p").filter({ hasText: /^Today/ })).toHaveText(/^TodayA\$\d+\.\d+ of A\$\d+\.\d\d$/);
  await expect(p.locator("p").filter({ hasText: /^This month/ })).toHaveText(/^This monthA\$\d+\.\d+ of A\$\d+\.\d\d$/);
  await expect(total(page, "Model calls today")).toHaveText(/^\d+$/);
  await expect(total(page, "Tokens today")).toBeVisible();

  await expect(p.getByRole("heading", { name: "Top users today" })).toHaveCount(0);
  await expect(p.getByRole("table")).toHaveCount(0);
  await expect(p.getByText("Limit reached")).toHaveCount(0);
  expect((await getJson<Usage>(page, "/console/usage")).people).toEqual([]);
});
