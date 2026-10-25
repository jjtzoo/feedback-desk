import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 21 (Admin: Dashboard). The numbers come from six items raised through the
// API as six staff and moved on by Chris; the checks are on /console/dashboard and in the console.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };
type Dash = {
  weekly: { week: string; received: number; resolved: number }[];
  avg_first_response_hours: number | null;
  project_reassignment_rate: number | null;
};

const IMPACT = ["Slowing me down", "I expected it to open but got a blank screen"];

// What the dashboard counts. Open means every stage before Closed, so Resolved counts as open.
//   started   Liam    RAKE Agent        bug             Fix          In progress   (Darlene)
//   approved  Aisha   Training Portal   bug             Fix          Approved      (Marc)
//   feature   Tom     RAKE Agent        feature request New feature  Awaiting approval (Darlene)
//   usability Grace   Training Portal   usability       Improvement  Awaiting approval (Marc)
//   resolved  Rafael  RAKE Agent        bug             Fix          Resolved      (Darlene)
//   closed    Mei     Training Portal   bug             Fix          Closed (not open)
// So: 5 open, 2 waiting for approval, 6 received this week, 1 resolved this week.
type Refs = Record<"started" | "approved" | "feature" | "usability" | "resolved" | "closed", string>;

/** Raise and move the six items; the tests only read what this leaves behind. */
async function build(team: Team): Promise<Refs> {
  const chris = await team.as("Chris");
  const approve = (ref: string) => postJson(chris, `/console/items/${ref}/approve`);
  const [liam, aisha, tom, grace, rafael, mei] = await Promise.all(["Liam", "Aisha", "Tom", "Grace", "Rafael", "Mei"].map((n) => team.as(n)));

  const started = await raiseBug(liam, "rake-agent", "The RAKE Agent export page shows an error when I open it");
  await approve(started);
  await postJson(chris, `/console/items/${started}/start`);

  const approved = await raiseBug(aisha, "training-portal", "The Training Portal course list shows an error when I open it");
  await approve(approved);

  const feature = await raise(tom, "Please add a dark mode to RAKE Agent", IMPACT, "rake-agent");
  const usability = await raise(grace, "The Training Portal course search is confusing to use", IMPACT, "training-portal");

  const resolved = await raiseBug(rafael, "rake-agent", "The RAKE Agent report page shows an error when I open it");
  await approve(resolved);
  await postJson(chris, `/console/items/${resolved}/resolve`, { body: "Fixed in this week's update" });

  const closed = await raiseBug(mei, "training-portal", "The Training Portal profile page shows an error when I open it");
  await approve(closed);
  await postJson(chris, `/console/items/${closed}/close`, { reason: "Not needed any more", wont_fix: false });

  return { started, approved, feature, usability, resolved, closed };
}

let refs: Refs;

// Built once per worker, in a hook with its own time, so a worker restarted after a failure rebuilds
// outside a test's time.
test.beforeAll(async ({ team }) => {
  test.setTimeout(240_000);
  refs = await build(team);
});

/** A headline figure: the box, and its big number. */
function stat(page: Page, label: string) {
  const box = page.getByText(label, { exact: true }).locator("xpath=..");
  return { box, value: box.locator("p").nth(1) };
}

/** The rows of one bar list as label -> count, in the order shown. */
async function bars(page: Page, title: string) {
  // Found by its heading: the section's aria-labelledby holds the title with spaces, so it has no accessible name.
  const rows = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) })
    .getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  const out: [string, number][] = [];
  for (const text of await rows.allInnerTexts()) {
    const m = text.trim().match(/^([\s\S]*?)\s*(\d+)$/);
    if (!m) throw new Error(`Unreadable bar row in ${title}: ${text}`);
    out.push([m[1].trim(), Number(m[2])]);
  }
  return out;
}

/** The numbers shown, as a plain object; also checks the list is ranked from most to fewest. */
function counts(rows: [string, number][]) {
  const n = rows.map(([, c]) => c);
  expect(n).toEqual([...n].sort((a, b) => b - a));
  return Object.fromEntries(rows);
}

const weeklyTable = (page: Page) => page.getByRole("region", { name: "Weekly trend" }).getByRole("table");
const rowCell = (row: Locator, i: number) => row.getByRole("cell").nth(i);

test("S21.01 Dashboard shows Open items, Waiting for approval, Avg time to first response and Project reassignment rate with targets", async ({ page, signIn, team }) => {
  const api = await getJson<Dash>(await team.as("Chris"), "/console/dashboard");
  await signIn("Chris");
  await page.goto("/console/dashboard");

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(stat(page, "Open items").value).toHaveText("5");
  await expect(stat(page, "Waiting for approval").value).toHaveText("2");
  // Nothing has waited two business days, so there is no warning under the count.
  await expect(page.getByText(/over 2 business days/)).toHaveCount(0);

  // Four items got a first response (approved, started, resolved or closed); the average is in hours.
  expect(api.avg_first_response_hours).not.toBeNull();
  const response = stat(page, "Avg time to first response");
  await expect(response.value).toHaveText(`${api.avg_first_response_hours} h`);
  await expect(response.box).toContainText("Target: under 2 business days");

  // No project has been corrected yet: 0 of 6.
  const rate = stat(page, "Project reassignment rate");
  await expect(rate.value).toHaveText("0%");
  await expect(rate.box).toContainText("Target: 10% or less");
});

test("S21.02 Weekly trend shows received and resolved for 8 weeks as a chart, and Show table gives the same as a table", async ({ page, signIn, team }) => {
  const api = await getJson<Dash>(await team.as("Chris"), "/console/dashboard");
  expect(api.weekly).toHaveLength(8);
  await signIn("Chris");
  await page.goto("/console/dashboard");

  const trend = page.getByRole("region", { name: "Weekly trend" });
  await expect(trend.getByRole("heading", { name: "Weekly trend" })).toBeVisible();
  await expect(trend.getByText("Received", { exact: true })).toBeVisible();
  await expect(trend.getByText("Resolved", { exact: true })).toBeVisible();

  // The chart: eight weeks, this week last, with the week's numbers above its bars.
  const chart = trend.getByRole("img", { name: /last 8 weeks/ });
  await expect(chart).toBeVisible();
  const weeks = chart.locator(":scope > div");
  await expect(weeks).toHaveCount(8);
  await expect(weeks.last().getByText("6", { exact: true })).toBeVisible();
  await expect(weeks.last().getByText("1", { exact: true })).toBeVisible();
  await expect(weeklyTable(page)).toHaveCount(0);

  const toggle = trend.getByRole("button", { name: "Show table" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(trend.getByRole("button", { name: "Show chart" })).toHaveAttribute("aria-pressed", "true");
  await expect(chart).toHaveCount(0);

  const table = weeklyTable(page);
  await expect(table.getByRole("columnheader")).toHaveText(["Week starting", "Received", "Resolved"]);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(8);
  for (const [i, w] of api.weekly.entries()) {
    // Every week starts on a Monday.
    await expect(rowCell(rows.nth(i), 0), `week ${i + 1} date`).toHaveText(new RegExp(`^Mon,? ${Number(w.week.slice(8, 10))} [A-Za-z]{3,4}$`));
    await expect(rowCell(rows.nth(i), 1), `week ${i + 1} received`).toHaveText(String(w.received));
    await expect(rowCell(rows.nth(i), 2), `week ${i + 1} resolved`).toHaveText(String(w.resolved));
  }
  // All six items were received and one was resolved, in the weeks shown.
  expect(api.weekly.reduce((n, w) => n + w.received, 0)).toBe(6);
  expect(api.weekly.reduce((n, w) => n + w.resolved, 0)).toBe(1);

  await trend.getByRole("button", { name: "Show chart" }).click();
  await expect(chart).toBeVisible();
  await expect(weeklyTable(page)).toHaveCount(0);
});

test("S21.03 Open by project, assignee, category and work type each list their open items with numbers", async ({ page, signIn }) => {
  await signIn("Chris");
  await page.goto("/console/dashboard");

  // The closed item (Mei's) is in none of them; the resolved one is.
  expect(counts(await bars(page, "Open by project"))).toEqual({ "RAKE Agent": 3, "Training Portal": 2 });
  expect(counts(await bars(page, "Open by assignee"))).toEqual({ Darlene: 3, Marc: 2 });
  expect(counts(await bars(page, "Open by category"))).toEqual({ Bug: 3, "Feature request": 1, Usability: 1 });
  expect(counts(await bars(page, "Open by work type"))).toEqual({ Fix: 3, "New feature": 1, Improvement: 1 });
});

test("S21.04 Open items equals the number of items in the console's All open inbox", async ({ page, signIn }) => {
  await signIn("Chris");
  await page.goto("/console/dashboard");
  const open = stat(page, "Open items").value;
  await expect(open).toHaveText("5");
  const shown = Number(await open.innerText());

  // Cards view lists every stage, one card per item.
  await page.goto("/console?inbox=open");
  await page.getByRole("radio", { name: "Cards", exact: true }).click();
  const cards = page.getByRole("button", { name: /FB-\d{4}/ });
  await expect(cards).toHaveCount(shown);
  await expect(cards.filter({ hasText: refs.resolved })).toHaveCount(1);
  await expect(cards.filter({ hasText: refs.closed })).toHaveCount(0);
});

test("S21.05 Correcting a project on one item moves the project reassignment rate after a reload", async ({ page, signIn }) => {
  await signIn("Chris");
  await page.goto("/console/dashboard");
  await expect(stat(page, "Project reassignment rate").value).toHaveText("0%");
  expect(counts(await bars(page, "Open by project"))).toEqual({ "RAKE Agent": 3, "Training Portal": 2 });

  // Move Liam's item from RAKE Agent to the Training Portal in the item panel.
  await page.goto(`/console?inbox=open&item=${refs.started}`);
  const panel = page.getByRole("dialog");
  const project = panel.getByRole("combobox", { name: /^Project/ });
  await expect(project).toContainText("RAKE Agent");
  await project.click();
  await page.getByRole("option", { name: "Training Portal", exact: true }).click();
  // The field follows the saved item, so this waits for the server's answer.
  await expect(project).toContainText("Training Portal");

  // One of the six items sent through the chat has had its project corrected: 1 of 6.
  await page.goto("/console/dashboard");
  const rate = stat(page, "Project reassignment rate").value;
  await expect(rate).toHaveText("17%");
  await expect(rate).not.toHaveText("0%");
  expect(counts(await bars(page, "Open by project"))).toEqual({ "Training Portal": 3, "RAKE Agent": 2 });
});
