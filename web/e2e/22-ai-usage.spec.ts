import type { Page } from "@playwright/test";

import { addUsage, clearUsage, expect, resetDatabase, test } from "./fixtures";
import { answerUntilCard, BUG, chatSay, getJson } from "./helpers";

// Manual checklist section 22: AI usage and spend limits (D36).
//
// The browser tests run the scripted stub model, which reports no token counts, and the stub embeddings are
// never recorded, so the stub never writes a usage row. The spend limits come from the API's settings and a
// test must not change them; the tests read them from the API and reach them by adding usage rows directly
// (`addUsage`), each test as its own person, and remove those rows afterwards so no limit leaks into the next.

test.beforeAll(resetDatabase);

type Usage = { people: unknown[] };
type Allowance = { limit_tokens: number; blocked: "user" | "budget" | null };
type Budgets = { daily_budget_aud: number; monthly_budget_aud: number };

const DETAILS = /What happened, or what would you like/;
const chat = (page: Page) => page.getByRole("region", { name: "Chat with Sig, the feedback assistant" });
const allowanceLine = (page: Page) => chat(page).locator("form p").filter({ hasText: "Today's assistant allowance" });

/** The person's daily token allowance, checked to be on (above 0) so a limit can be reached. */
async function dailyLimit(page: Page) {
  const { limit_tokens } = await getJson<Allowance>(page, "/usage/me");
  expect(limit_tokens).toBeGreaterThan(0);
  return limit_tokens;
}

/** Open /chat and return what the API answered to the chat start. */
async function startChat(page: Page) {
  const started = page.waitForResponse((r) => r.url().endsWith("/api/chat/sessions") && r.request().method() === "POST");
  await page.goto("/chat");
  return (await started).json();
}

const panel = (page: Page) => page.getByRole("region", { name: "AI usage" });
/** The value under a label in the panel's totals (Model calls today, Tokens today, Cost per item (30 days)). */
const total = (page: Page, label: string) => panel(page).locator(`dt:text-is("${label}") + dd`).first();

/** The dashboard, waited on until the AI usage panel (it loads after the rest of the page) has drawn. */
async function openPanel(page: Page) {
  await page.goto("/console/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(panel(page)).toBeVisible();
}

// The "hidden when the limit is 0" half of S22.01 is not reachable: the test API fixes the limit.
test("S22.01 Open /chat: nothing under the box below half the allowance, then 'Today's assistant allowance: N% used' with a meter", async ({ page, signIn }) => {
  const aisha = await signIn("Aisha");
  const limit = await dailyLimit(page);
  const meter = chat(page).getByRole("meter", { name: "Today's assistant allowance used" });
  try {
    // No usage: the answer has arrived and Sig has greeted, so the empty space under the box is what the person sees.
    const allowance = page.waitForResponse((r) => r.url().includes("/api/usage/me"));
    await page.goto("/chat");
    await allowance;
    await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
    await expect(allowanceLine(page)).toHaveCount(0);
    await expect(meter).toHaveCount(0);

    addUsage({ email: aisha.email, tokens: Math.ceil(limit * 0.5) });
    await page.goto("/chat");
    await expect(allowanceLine(page)).toHaveText("Today's assistant allowance: 50% used");
    await expect(meter).toHaveAttribute("aria-valuenow", "50");
  } finally {
    clearUsage();
  }
});

const HEADS_UP = /Quick heads-up: you've used (\d+% of )?today's allowance with me\. We'll still finish this report/;

test("S22.02 At 80 % or more the line turns amber with a warning icon, and Sig says once in the chat that this report will still finish", async ({ page, signIn }) => {
  const grace = await signIn("Grace");
  const limit = await dailyLimit(page);
  try {
    // Below 80 %: grey, no icon. (Percent rounds half to even, so seed whole percents from above.)
    addUsage({ email: grace.email, tokens: Math.ceil(limit * 0.6) });
    await page.goto("/chat");
    const line = allowanceLine(page);
    await expect(line).toHaveText("Today's assistant allowance: 60% used");
    await expect(line).toHaveCSS("color", "rgb(91, 97, 107)");
    await expect(line.locator("svg")).toHaveCount(0);
    await expect(chat(page).getByText(HEADS_UP)).toHaveCount(0);

    addUsage({ email: grace.email, tokens: Math.ceil(limit * 0.85) - Math.ceil(limit * 0.6) });
    await page.goto("/chat");
    await expect(line).toHaveText("Today's assistant allowance: 85% used");
    await expect(chat(page).getByText(HEADS_UP)).toContainText(
      "Quick heads-up: you've used 85% of today's allowance with me. We'll still finish this report, so nothing's lost. Anything new after the allowance runs out goes through a short form until tomorrow.",
    );
    await expect(line).toHaveCSS("color", "rgb(180, 83, 9)");
    await expect(line.locator("svg.lucide-triangle-alert")).toBeVisible();
    const meter = chat(page).getByRole("meter", { name: "Today's assistant allowance used" });
    await expect(meter).toHaveAttribute("aria-valuenow", "85");
    await expect(meter.locator("div")).toHaveCSS("background-color", "rgb(180, 83, 9)");
    await expect(chat(page).getByLabel("Your message")).toBeEditable();

    // Once per chat: another turn does not repeat it.
    await chatSay(page, BUG);
    await expect(chat(page).getByText(HEADS_UP)).toHaveCount(1);
  } finally {
    clearUsage();
  }
});

test("S22.03 At the personal limit a new chat opens the backup form with \"You've used today's allowance with Sig. It resets tomorrow.\"", async ({ page, signIn }) => {
  const rafael = await signIn("Rafael");
  const limit = await dailyLimit(page);
  try {
    addUsage({ email: rafael.email, tokens: limit });
    expect((await getJson<Allowance>(page, "/usage/me")).blocked).toBe("user");

    expect(await startChat(page)).toMatchObject({ mode: "fallback", limit: "user" });
    await expect(chat(page).getByText("You've used today's allowance with Sig. It resets tomorrow.", { exact: true })).toBeVisible();
    await expect(chat(page).getByText("Not available right now", { exact: true })).toBeVisible();
    await expect(chat(page).getByLabel(DETAILS)).toBeVisible();
    await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toHaveCount(0);
  } finally {
    clearUsage();
  }
});

test("S22.04 At the daily or monthly budget a new chat opens the backup form with 'Sig is paused for today to keep costs in check.'", async ({ page, signIn, team }) => {
  test.slow(); // each usage change runs a script
  await signIn("Mei");
  const budgets = await getJson<Budgets>(await team.as("Marc"), "/console/usage");
  expect(budgets.daily_budget_aud).toBeGreaterThan(0);
  expect(budgets.monthly_budget_aud).toBeGreaterThan(0);
  try {
    // Today's spend, by everyone, reaches the daily budget.
    addUsage({ cost: budgets.daily_budget_aud });
    expect(await startChat(page)).toMatchObject({ mode: "fallback", limit: "budget" });
    await expect(chat(page).getByText("Sig is paused for today to keep costs in check.", { exact: true })).toBeVisible();
    await expect(chat(page).getByText("Not available right now", { exact: true })).toBeVisible();

    // This month's spend, from earlier in the month, reaches the monthly budget.
    clearUsage();
    addUsage({ cost: budgets.monthly_budget_aud, monthStart: true });
    expect(await startChat(page)).toMatchObject({ mode: "fallback", limit: "budget" });
    await expect(chat(page).getByText("Sig is paused for today to keep costs in check.", { exact: true })).toBeVisible();
  } finally {
    clearUsage();
  }
});

test("S22.05 Reaching a limit mid-chat: the chat carries on, an existing confirm card can still be confirmed, and a new chat opens the backup form", async ({ page, signIn }) => {
  test.slow(); // two chats and a usage change
  const tom = await signIn("Tom");
  const limit = await dailyLimit(page);
  // A second chat, open before the limit: it carries on after the limit is reached, while a new chat cannot start.
  const other = await page.context().newPage();
  try {
    await other.goto("/chat");
    await chatSay(other, BUG);
    await page.goto("/chat");
    await chatSay(page, BUG);
    await answerUntilCard(page);

    addUsage({ email: tom.email, tokens: limit });
    expect((await getJson<Allowance>(page, "/usage/me")).blocked).toBe("user");
    await page.getByRole("region", { name: "Your feedback" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ })).toBeVisible();

    // The open chat keeps going with Sig, who says the report will still finish.
    await chatSay(other, "It happens every morning");
    await expect(chat(other).getByText(/Quick heads-up: you've used today's allowance with me\./)).toBeVisible();
    await expect(chat(other).getByLabel(DETAILS)).toHaveCount(0);
    await expect(chat(other).getByLabel("Your message")).toBeEditable();

    expect(await startChat(page)).toMatchObject({ mode: "fallback", limit: "user" });
    await expect(chat(page).getByLabel(DETAILS)).toBeVisible();
  } finally {
    await other.close();
    clearUsage();
  }
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

test("S22.07 As Darlene the dashboard is for Admins, so there is no AI usage panel, and the usage API sends her no per-person rows", async ({ page, signIn }) => {
  // With no usage recorded, an Admin would not see rows either (the stub writes none), so what this can prove is
  // that Darlene gets no panel and the API sends her no people; the backend test covers the rows.
  await signIn("Darlene");
  await page.goto("/console/dashboard");
  await expect(page.getByText("The dashboard is for Admins.")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByText("Top users today")).toHaveCount(0);
  expect((await getJson<Usage>(page, "/console/usage")).people).toEqual([]);
});
