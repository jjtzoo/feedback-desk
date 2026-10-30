import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, holderOf, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 21 (Admin: Dashboard, D112). The numbers come from twelve items raised through the
// API by six staff and moved on by Chris and each item's holder; the checks are on /console/dashboard as Chris.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };
type Figure = { value: number | null; previous: number | null; trend: (number | null)[]; count: number };
type Dash = {
  backlog: Figure;
  first_response_hours: Figure;
  flow: { week: string; received: number; resolved: number; backlog: number }[];
  stuck: { stage: string; bands: number[] }[];
  team: { id: string; name: string; open: number; overdue: number; oldest_days: number | null }[];
};

const IMPACT = ["Slowing me down", "I expected it to open but got a blank screen"];

// What the dashboard counts. The backlog is every stage before Resolved.
//   started   Liam    RAKE Agent       chat     In progress
//   approved  Aisha   Training Portal  chat     Approved
//   feature   Tom     RAKE Agent       chat     Awaiting approval
//   usability Grace   Training Portal  chat     Awaiting approval
//   resolved  Rafael  RAKE Agent       chat     Resolved (not backlog)
//   closed    Mei     Training Portal  chat     Closed (not backlog)
//   six more, one per person, through the backup form: Needs review, three per tool
// So: 12 received this week, 1 resolved, 10 in the backlog (6 Needs review, 2 Awaiting approval, 1 Approved, 1 In progress).
type Refs = Record<"started" | "approved" | "feature" | "usability" | "resolved" | "closed", string>;

/** Raise and move the twelve items; the tests only read what this leaves behind. */
async function build(team: Team): Promise<Refs> {
  const chris = await team.as("Chris");
  const approve = (ref: string) => postJson(chris, `/console/items/${ref}/approve`);
  const people = await Promise.all(["Liam", "Aisha", "Tom", "Grace", "Rafael", "Mei"].map((n) => team.as(n)));
  const [liam, aisha, tom, grace, rafael, mei] = people;

  const started = await raiseBug(liam, "rake-agent", "The RAKE Agent export page shows an error when I open it");
  await approve(started);
  await postJson(await team.as(await holderOf(chris, started)), `/console/items/${started}/start`);

  const approved = await raiseBug(aisha, "training-portal", "The Training Portal course list shows an error when I open it");
  await approve(approved);

  const feature = await raise(tom, "Please add a dark mode to RAKE Agent", IMPACT, "rake-agent");
  const usability = await raise(grace, "The Training Portal course search is confusing to use", IMPACT, "training-portal");

  // Due in a week and resolved today, so On time counts it.
  const resolved = await raiseBug(rafael, "rake-agent", "The RAKE Agent report page shows an error when I open it");
  await postJson(chris, `/console/items/${resolved}/approve`, { due_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) });
  await postJson(await team.as(await holderOf(chris, resolved)), `/console/items/${resolved}/resolve`, { body: "Fixed in this week's update" });

  const closed = await raiseBug(mei, "training-portal", "The Training Portal profile page shows an error when I open it");
  await approve(closed);
  await postJson(chris, `/console/items/${closed}/close`, { reason: "Not needed any more", ending: "no_longer_needed" });

  for (const [i, page] of people.entries()) {
    await postJson(page, "/feedback/fallback", {
      project_slug: i % 2 ? "training-portal" : "rake-agent",
      details: `The ${i % 2 ? "Training Portal" : "RAKE Agent"} page number ${i + 1} is slow to load`,
      how_much: "annoying",
    });
  }
  return { started, approved, feature, usability, resolved, closed };
}

let refs: Refs;

// Built once per worker, in a hook with its own time, so a worker restarted after a failure rebuilds
// outside a test's time.
test.beforeAll(async ({ team }) => {
  test.setTimeout(240_000);
  refs = await build(team);
});

/** A headline figure: its box, big number and the line saying how it changed. */
function tile(page: Page, label: string) {
  const box = page.locator("p", { hasText: new RegExp(`^${label}$`) }).locator("xpath=..");
  return { box, value: box.locator("p").nth(1), change: box.locator("p").nth(2) };
}

const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });

/** Rows of a table as arrays of cell texts. */
async function cells(page: Page, title: string) {
  const rows = card(page, title).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  return Promise.all((await rows.all()).map((r) => r.getByRole("cell").allInnerTexts()));
}

async function open(page: Page, signIn: (first: string) => Promise<unknown>) {
  await signIn("Chris");
  await page.goto("/console/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

test("S21.01 Dashboard shows Open backlog, Median time to first response, Median time to resolve and On time, each with its change and trend", async ({ page, signIn, team }) => {
  const api = await getJson<Dash>(await team.as("Chris"), "/console/dashboard");
  await open(page, signIn);

  // Ten items are before Resolved; four weeks ago there were none.
  const backlog = tile(page, "Open backlog");
  await expect(backlog.value).toHaveText("10");
  await expect(backlog.change).toHaveText("10 more than 4 weeks ago");
  await expect(backlog.box).toContainText("New to In progress, not yet resolved");
  await expect(backlog.box.locator("svg polyline")).toHaveCount(1);

  // Four items got a first response (approved, started, resolved or closed), all this week.
  expect(api.first_response_hours.count).toBe(4);
  const response = tile(page, "Median time to first response");
  await expect(response.value).toHaveText(/^\d+(\.\d)? h$/);
  await expect(response.box).toContainText("Target: under 2 business days");

  await expect(tile(page, "Median time to resolve").value).toHaveText(/^\d+(\.\d)? h$/);
  await expect(tile(page, "Median time to resolve").box).toContainText("1 resolved");
  await expect(tile(page, "On time").value).toHaveText("100%");
  await expect(tile(page, "On time").box).toContainText("Resolved by the due date, of 1 with one");
});

test("S21.02 Last 4 weeks and Last 12 weeks change every figure, chart and table to that period", async ({ page, signIn }) => {
  await open(page, signIn);
  const period = page.getByRole("radiogroup", { name: "Period" });
  await expect(period.getByRole("radio", { name: "Last 4 weeks" })).toBeChecked();
  await expect(card(page, "Flow")).toContainText("over the last 4 weeks");
  await expect(card(page, "Tools")).toContainText("in the last 4 weeks");

  const answer = page.waitForResponse((r) => r.url().includes("/api/console/dashboard?weeks=12"));
  await period.getByRole("radio", { name: "Last 12 weeks" }).click();
  await answer;
  await expect(card(page, "Flow")).toContainText("over the last 12 weeks");
  await expect(card(page, "Tools")).toContainText("in the last 12 weeks");
  await expect(card(page, "Quality")).toContainText("In the last 12 weeks");
  await expect(tile(page, "Open backlog").change).toHaveText("10 more than 12 weeks ago");
  await expect(card(page, "Flow").getByRole("group").locator(":scope > div")).toHaveCount(12);
  await card(page, "Flow").getByRole("button", { name: "Show table" }).click();
  await expect(card(page, "Flow").locator("tbody tr")).toHaveCount(12);
});

test("S21.03 Flow shows received and resolved as bars and the backlog as a line, the same as a table, and Not enough data yet under 10 items", async ({ page, signIn, team }) => {
  const api = await getJson<Dash>(await team.as("Chris"), "/console/dashboard");
  await open(page, signIn);
  const flow = card(page, "Flow");
  await expect(flow.getByRole("listitem")).toHaveText(["Received", "Resolved", "Open backlog"]);

  // Four weeks, this week last, each with its numbers for screen readers and the tooltip.
  const weeks = flow.getByRole("group", { name: /Flow for the last 4 weeks/ }).locator(":scope > div");
  await expect(weeks).toHaveCount(4);
  await expect(weeks.last()).toHaveAccessibleName(/: 12 received, 1 resolved, 10 open at the end$/);
  await expect(flow.locator("svg polyline")).toHaveCount(1);

  const toggle = flow.getByRole("button", { name: "Show table" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(flow.getByRole("columnheader")).toHaveText(["Week starting", "Received", "Resolved", "Open at week end"]);
  expect(await cells(page, "Flow")).toEqual(api.flow.map((w) => [expect.stringMatching(/^Mon,? \d+ [A-Za-z]{3,4}$/), String(w.received), String(w.resolved), String(w.backlog)]));
  await flow.getByRole("button", { name: "Show chart" }).click();
  await expect(weeks).toHaveCount(4);

  // Fewer than ten received: the plain counts instead of a chart. Given here, since the app can't un-raise items.
  await page.route("**/api/console/dashboard?weeks=4", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Dash;
    await route.fulfill({ response, json: { ...body, flow: body.flow.map((w) => ({ ...w, received: Math.min(w.received, 9) })) } });
  });
  await page.reload();
  await expect(flow).toContainText("Not enough data yet");
  await expect(flow).toContainText("9 received and 1 resolved in the last 4 weeks; 10 open now.");
  await expect(flow.getByRole("button", { name: "Show table" })).toHaveCount(0);
});

test("S21.04 Where it's stuck splits open items by stage and time in it, with a table and Not enough data yet under 10", async ({ page, signIn }) => {
  await open(page, signIn);
  const stuck = card(page, "Where it's stuck");
  await expect(stuck.getByRole("list").first().getByRole("listitem")).toHaveText(["Under 2 days", "2 to 7 days", "1 to 4 weeks", "Over 4 weeks"]);
  const rows = stuck.getByRole("list", { name: /Open items by stage/ }).getByRole("listitem");
  await expect(rows).toHaveText([/^New\s*0$/, /^Needs review\s*6$/, /^Awaiting approval\s*2$/, /^Approved\s*1$/, /^In progress\s*1$/]);
  await expect(rows.nth(1)).toHaveAccessibleName("Needs review: 6 open; 6 under 2 days, 0 2 to 7 days, 0 1 to 4 weeks, 0 over 4 weeks");

  await stuck.getByRole("button", { name: "Show table" }).click();
  await expect(stuck.getByRole("columnheader")).toHaveText(["Stage", "Under 2 days", "2 to 7 days", "1 to 4 weeks", "Over 4 weeks", "Total"]);
  expect(await cells(page, "Where it's stuck")).toEqual([
    ["New", "0", "0", "0", "0", "0"],
    ["Needs review", "6", "0", "0", "0", "6"],
    ["Awaiting approval", "2", "0", "0", "0", "2"],
    ["Approved", "1", "0", "0", "0", "1"],
    ["In progress", "1", "0", "0", "0", "1"],
  ]);

  // Nothing has waited two business days for approval, so there is no warning.
  await expect(stuck.getByText(/waiting for approval over 2 business days/)).toHaveCount(0);

  // Under ten open: the plain counts. Given here, since the app can't make items vanish.
  await page.route("**/api/console/dashboard?weeks=4", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Dash;
    await route.fulfill({ response, json: { ...body, stuck: body.stuck.map((s) => (s.stage === "needs_review" ? { ...s, bands: [5, 0, 0, 0] } : s)) } });
  });
  await page.reload();
  await expect(stuck).toContainText("Not enough data yet");
  await expect(stuck).toContainText("New 0 · Needs review 5 · Awaiting approval 2 · Approved 1 · In progress 1");
});

test("S21.05 Tools and Team sort by the clicked column, and a row opens Work filtered to that tool or person", async ({ page, signIn, team }) => {
  const api = await getJson<Dash>(await team.as("Chris"), "/console/dashboard");
  await open(page, signIn);

  // Five open each, so the names break the tie; RAKE Agent resolved one item, the Training Portal none.
  expect(await cells(page, "Tools")).toEqual([
    ["RAKE Agent", "6", "5", "0 d", "0", "1", "0"],
    ["Training Portal", "6", "5", "0 d", "0", "0", "0"],
  ]);
  const resolved = card(page, "Tools").getByRole("columnheader", { name: "Resolved" });
  await resolved.getByRole("button").click();
  await expect(resolved).toHaveAttribute("aria-sort", "descending");
  await expect(card(page, "Tools").locator("tbody tr").first()).toContainText("RAKE Agent");
  await resolved.getByRole("button").click();
  await expect(resolved).toHaveAttribute("aria-sort", "ascending");
  await expect(card(page, "Tools").locator("tbody tr").first()).toContainText("Training Portal");

  // Team: every Digital Staff member and Admin, most open first, as the API counts them.
  expect((await cells(page, "Team")).map(([name, open]) => [name, open])).toEqual(api.team.map((p) => [p.name, String(p.open)]));

  await card(page, "Tools").locator("tbody tr").first().getByRole("cell").nth(2).click();
  await expect(page).toHaveURL(/\/console\?inbox=open&project=training-portal$/);

  await page.goBack();
  const busiest = api.team[0];
  await card(page, "Team").getByRole("link", { name: busiest.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/console\\?inbox=open&assignee=${busiest.id}$`));
});

test("S21.06 Open backlog equals the console's All open inbox without its Resolved items", async ({ page, signIn }) => {
  await open(page, signIn);
  const backlog = tile(page, "Open backlog").value;
  await expect(backlog).toHaveText("10");
  const shown = Number(await backlog.innerText());

  // Cards view lists every stage, one card per item; the Resolved one is the only one not in the backlog.
  await page.goto("/console?inbox=open");
  await page.getByRole("radio", { name: "Cards", exact: true }).click();
  const cards = page.getByRole("button", { name: /FB-\d{4}/ });
  await expect(cards).toHaveCount(shown + 1);
  await expect(cards.filter({ hasText: refs.resolved })).toHaveCount(1);
  await expect(cards.filter({ hasText: refs.closed })).toHaveCount(0);
});

test("S21.07 Correcting a project on one item moves Quality's routing corrections after a reload", async ({ page, signIn }) => {
  await open(page, signIn);
  const corrections = card(page, "Quality").getByText("Routing corrections", { exact: true }).locator("xpath=..");
  await expect(corrections).toContainText("0%");
  await expect(corrections).toContainText("0 of 6 from the chat · Target: 10% or less");

  // Move Liam's item from RAKE Agent to the Training Portal in the item panel.
  await page.goto(`/console?inbox=open&item=${refs.started}`);
  const panel = page.getByRole("dialog");
  const project = panel.getByRole("combobox", { name: /^Project/ });
  await expect(project).toContainText("RAKE Agent");
  await project.click();
  await page.getByRole("option", { name: "Training Portal", exact: true }).click();
  // The change waits for Save (D104); the field follows the saved item, so this waits for the server's answer.
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(project).toContainText("Training Portal");

  // One of the six items sent through the chat has had its project corrected: 1 of 6.
  await page.goto("/console/dashboard");
  await expect(corrections).toContainText("17%");
  await expect(corrections).toContainText("1 of 6 from the chat");
  expect((await cells(page, "Tools")).map(([name, , open]) => [name, open])).toEqual([
    ["Training Portal", "6"],
    ["RAKE Agent", "4"],
  ]);
});

test("S21.08 Darlene has no Dashboard in the side menu, and its address says it is for Admins", async ({ page, signIn }) => {
  await signIn("Darlene");
  await page.goto("/console/dashboard");
  await expect(page.getByText("The dashboard is for Admins.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(0);
  const r = await page.request.get("/api/console/dashboard");
  expect(r.status()).toBe(403);
});
