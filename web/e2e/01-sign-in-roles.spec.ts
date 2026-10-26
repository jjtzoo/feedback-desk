import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { raiseBug, signOut } from "./helpers";

// Manual checklist section 1: sign-in and roles. The local sign-in box is the dev picker (spec D23);
// "Continue with Google" is disabled here because the test API has no Google client.

test.beforeAll(resetDatabase);

const heading = (page: Page) => page.getByRole("heading", { name: "Sign in", exact: true });
const account = (page: Page, first: string) => page.getByRole("button", { name: `Account: ${first}` });
const consoleNav = (page: Page) => page.getByRole("navigation", { name: "Console" });

/** The sign-in page with the picker loaded. Pass the page a person asked for, or nothing. */
async function openSignIn(page: Page, next?: string) {
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await expect(heading(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Digital team" })).toBeVisible();
}

/** Click a person in the picker; the name is enough because each appears once. */
async function pick(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

/** Sign out through the account menu, the way a person does, and wait for the sign-in page. */
async function signOutFromMenu(page: Page, first: string) {
  await account(page, first).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(heading(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/sign-in");
}

const here = (page: Page) => new URL(page.url());

test("S01.01 Signed out, opening /my lands on /sign-in?next=/my", async ({ page }) => {
  // This page has no sign-in cookie.
  await page.goto("/my");
  await expect(heading(page)).toBeVisible();
  expect(here(page).pathname).toBe("/sign-in");
  expect(here(page).searchParams.get("next")).toBe("/my");
});

test("S01.02 'Continue with Google' is disabled with the not-configured note, under the heading and its line", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText("Use your REDADAIR Google account. No separate password is needed.", { exact: true })).toBeVisible();
  // The note only shows once the page has asked the server about Google.
  await expect(page.getByText("Google sign-in is not yet configured on this server")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: /Continue with Google/ })).toHaveCount(0);
});

test("S01.03 The picker lists Chris, Marc, Mike as Admin and Darlene, Mario as Digital Staff with emails, then Staff by company", async ({ page }) => {
  await openSignIn(page);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Digital team", "REDMEN", "ADAIR", "Offshore ops"]);

  const team = page.getByRole("region", { name: "Digital team" }).getByRole("button");
  await expect(team).toHaveText([
    /Chris\s*chris@redadair\.example\s*Admin$/,
    /Marc\s*marc@redadair\.example\s*Admin$/,
    /Mike\s*mike@redadair\.example\s*Admin$/,
    /Darlene\s*darlene@redadair\.example\s*Digital Staff$/,
    /Mario\s*mario@redadair\.example\s*Digital Staff$/,
  ]);

  // Staff rows show the person's job under the name; the picker has no email for them.
  const staff: [string, RegExp[]][] = [
    ["REDMEN", [/Liam Carter.*Staff$/, /Aisha Rahman.*Staff$/]],
    ["ADAIR", [/Tom Nguyen.*Staff$/, /Grace O'Brien.*Staff$/]],
    ["Offshore ops", [/Rafael Santos.*Staff$/, /Mei Lin.*Staff$/]],
  ];
  for (const [company, people] of staff) {
    await expect(page.getByRole("region", { name: company }).getByRole("button")).toHaveText(people);
  }
});

test("S01.04 Signed out, asking for /my and clicking Mario lands on /my with Mario in the header", async ({ page }) => {
  await page.goto("/my");
  await expect(heading(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Digital team" })).toBeVisible();
  await pick(page, "Mario");
  await expect(account(page, "Mario")).toBeVisible();
  await expect(page).toHaveURL(/\/my$/);
});

test("S01.05 From a bare /sign-in, Mario and Chris land on the console (Work) and Liam lands on /chat", async ({ page }) => {
  for (const first of ["Mario", "Chris"]) {
    await openSignIn(page);
    await pick(page, first);
    await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
    await expect(page, `${first} lands on`).toHaveURL(/\/console$/);
    // Leave the console first: its second board load would get a 401 after sign-out, and the app's own
    // redirect (/sign-in?next=/console) would race the next page.goto.
    await page.goto("about:blank");
    await signOut(page);
  }

  await openSignIn(page);
  await expect(page).toHaveURL(/\/sign-in$/); // nothing left over in ?next=
  await pick(page, "Liam Carter");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
});

test("S01.06 /sign-in?error=domain shows a red alert that Smoke Signal is only for REDADAIR Google accounts", async ({ page }) => {
  await page.goto("/sign-in?error=domain");
  await expect(heading(page)).toBeVisible();
  // Next.js adds its own invisible route announcer with the alert role, so pick ours by its text.
  const alert = page.getByRole("alert").filter({ hasText: "Smoke Signal is only for" });
  await expect(alert).toContainText("Smoke Signal is only for REDADAIR Google accounts");
  // The red is the destructive text colour of the alert component.
  await expect(alert).toHaveClass(/text-destructive/);
});

test("S01.07 Mario's round initials badge, next to the bell, drops a menu with his name, email, Digital Staff and Sign out", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/");
  const badge = account(page, "Mario");
  await expect(badge).toBeVisible();
  await expect(badge.locator('[data-slot="avatar-fallback"]')).toHaveText("M");
  await expect(badge.locator("svg.lucide-chevron-down")).toHaveCount(1);

  // The bell comes first and the badge last, in the header's right side.
  const buttons = page.getByRole("banner").getByRole("button", { name: /^(Notifications|Account:)/ });
  await expect(buttons.first()).toHaveAccessibleName(/^Notifications/);
  await expect(buttons.last()).toHaveAccessibleName("Account: Mario");

  await badge.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Mario");
  await expect(menu).toContainText("mario@redadair.example");
  await expect(menu).toContainText("Digital Staff");
  // Give feedback and the console are header buttons now, so the only item is Sign out.
  await expect(menu.getByRole("menuitem")).toHaveText(["Sign out"]);
});

test("S01.08 Mario on the staff home page has a Console button in the header, and it opens the console", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/");
  const button = page.getByRole("banner").getByRole("link", { name: "Console" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page).toHaveURL(/\/console$/);
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
});

test("S01.09 'Smoke Signal home' in the console header opens the staff home page in one click", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Smoke Signal home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What can we help you with?");
  await expect(page).toHaveURL(/\/$/);
});

test("S01.10 After Sign out, opening /console sends you back to the sign-in page", async ({ page, signIn }) => {
  await signIn("Mario");
  await page.goto("/");
  await expect(account(page, "Mario")).toBeVisible();
  await signOutFromMenu(page, "Mario");

  await page.goto("/console");
  await expect(heading(page)).toBeVisible();
  expect(here(page).pathname).toBe("/sign-in");
  expect(here(page).searchParams.get("next")).toBe("/console");
  await expect(page.getByRole("heading", { name: "Work" })).toHaveCount(0);
});

test("S01.11 Darlene's console side menu shows Work, Channels, Releases, Dashboard, Admin and no Approvals", async ({ page, signIn }) => {
  await signIn("Darlene");
  await page.goto("/console");
  await expect(consoleNav(page)).toBeVisible();
  await expect(consoleNav(page).getByRole("link")).toHaveText(["Work", /^Assigned to me/, /^Triage/, /^Overdue/, "Channels", "Releases", "Dashboard", "Admin"]);
  await expect(consoleNav(page).getByRole("link", { name: "Approvals" })).toHaveCount(0);
});

test("S01.12 After signing out from the account menu, Chris lands on the console and its side menu also lists Approvals", async ({ page, signIn }) => {
  await signIn("Darlene");
  await page.goto("/console");
  await expect(consoleNav(page)).toBeVisible();
  await signOutFromMenu(page, "Darlene");

  await expect(page.getByRole("region", { name: "Digital team" })).toBeVisible();
  await pick(page, "Chris");
  await expect(page.getByRole("heading", { name: "Work", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/console$/);
  await expect(consoleNav(page).getByRole("link")).toHaveText([/^Approvals/, "Work", /^Assigned to me/, /^Triage/, /^Overdue/, "Channels", "Releases", "Dashboard", "Admin"]);
  // An Admin starts on what is open; the Digital team starts on what is theirs.
  await expect(page.getByRole("tab", { name: /^All open/ })).toHaveAttribute("aria-selected", "true");
});

test("S01.13 Darlene typing /console/approvals sees 'Approvals are for Admins (Mike, Chris or Marc).'", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  // An item is waiting for approval, so the Admin-only queue has something to leak.
  const title = "RAKE Agent crashes when I open the approvals page";
  await raiseBug(await team.as("Aisha"), "rake-agent", title);

  await page.goto("/console/approvals");
  await expect(page.getByText("Approvals are for Admins (Mike, Chris or Marc).")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).not.toContainText(title);
  await expect(main).not.toContainText(/FB-\d{4}/);
  await expect(main.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("S01.14 Darlene opening /api/console/approvals gets 'You can't open that' with Back to Smoke Signal, no JSON or item data", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const title = "RAKE Agent crashes when I open the approvals address";
  await raiseBug(await team.as("Tom"), "rake-agent", title);

  // page.goto is a document navigation, like typing the address.
  await page.goto("/api/console/approvals");
  await expect(page.getByRole("heading", { name: "You can't open that" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Smoke Signal" })).toHaveAttribute("href", "/");
  const main = page.getByRole("main");
  await expect(main).not.toContainText(title);
  await expect(main).not.toContainText(/FB-\d{4}/);
  await expect(main).not.toContainText(/[{}]/);
});

test("S01.15 Staff opening /console see 'The console is for the Digital team' with a Give feedback button", async ({ page, signIn }) => {
  await signIn("Liam");
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "The console is for the Digital team" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Give feedback" })).toHaveAttribute("href", "/chat");
  await expect(consoleNav(page)).toHaveCount(0);
});

test("S01.16 The staff header has no Console button for staff", async ({ page, signIn }) => {
  await signIn("Liam");
  await page.goto("/");
  // The header is loaded once the account badge and the main links are there.
  await expect(account(page, "Liam")).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Give feedback" }).first()).toBeVisible();
  await expect(header.getByRole("link", { name: "Console" })).toHaveCount(0);
});
