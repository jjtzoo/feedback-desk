import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { BUG, chatSay, getJson, raiseBug } from "./helpers";

// Manual checklist section 4: the confirm card, from the card itself to where a confirmed item goes.

test.beforeAll(resetDatabase);

const EXPECTED = "I expected it to open but got a blank screen";

// People are spread over the tests: the API allows 20 chats per person per hour.
// Descriptions carry a tool's name and "error", so the stub knows the tool and the type and asks only
// about impact and what was expected.

const card = (page: Page) => page.getByRole("region", { name: "Your feedback" });
/** The value next to a label on the card (Tool, Type, Title, Summary, Priority). */
const field = (page: Page, label: string) => card(page).locator(`dt:text-is("${label}") + dd`);
const chat = (page: Page) => page.getByRole("region", { name: /Chat with Sig/ });

async function openChat(page: Page) {
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
}

/** Describe it, choose how much it affects the person, say what was expected: the confirm card shows. */
async function reachCard(page: Page, description: string, impact = "Slowing me down") {
  await openChat(page);
  await chatSay(page, description);
  await page.getByRole("button", { name: impact, exact: true }).click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, EXPECTED);
  await expect(card(page)).toBeVisible();
}

/** Press Confirm and return the reference from "Sent. Your reference is FB-nnnn". */
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Confirm" }).click();
  const heading = page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).match(/FB-\d{4}/)![0];
}

/** A console inbox in Cards view, which lists every stage, so an item shows wherever it is. */
async function inboxCards(page: Page, inbox: string) {
  await page.goto(`/console?inbox=${inbox}`);
  await page.getByRole("radio", { name: "Cards", exact: true }).click();
}

test("S04.01 The card is headed 'Your feedback' with Tool, Type, Title, Summary and a labelled Priority, and focus lands on it", async ({ page, signIn }) => {
  await signIn("Aisha");
  // The card leaves Summary out when it repeats the title, so the first sentence is longer than a title (80 characters).
  await reachCard(page, "The Training Portal shows an error and a blank page whenever I try to open the certificate for a course I finished last week");
  await expect(page.getByRole("heading", { name: "Your feedback" })).toBeFocused();
  await expect(card(page).locator("dt")).toHaveText(["Tool", "Type", "Title", "Summary", "Priority"]);
  await expect(field(page, "Tool")).toHaveText("Training Portal");
  await expect(field(page, "Type")).toHaveText("Fix · Bug");
  await expect(field(page, "Title")).toHaveText(/^The Training Portal shows an error.+\.\.\.$/);
  await expect(field(page, "Summary")).toHaveText(/whenever I try to open the certificate for a course I finished last week$/);
  await expect(field(page, "Priority")).toHaveText("Major");
});

test("S04.02 'Slowing me down' gives Major (P2), and 'annoying' appears nowhere in the chips, card or Sig's messages", async ({ page, signIn }) => {
  await signIn("Tom");
  await openChat(page);
  await chatSay(page, BUG);
  const slowing = page.getByRole("button", { name: "Slowing me down", exact: true });
  await expect(slowing).toBeVisible();
  await expect(chat(page)).not.toContainText(/annoy/i);
  await slowing.click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, "I expected my certificate to open but got a blank screen");
  await expect(card(page)).toBeVisible();
  await expect(field(page, "Priority")).toHaveText("Major");
  await expect(chat(page)).not.toContainText(/annoy/i);
});

test("S04.03 Before Confirm the item is not in Darlene's All open inbox; after Confirm it is", async ({ page, signIn, team }) => {
  await signIn("Grace");
  // A control item that is already in the inbox, so "not there" is read from a loaded list.
  await raiseBug(page, "rake-agent", "RAKE Agent export report fails with an error");
  await reachCard(page, "The CPD Tracker shows an error when I save my points");
  const title = (await field(page, "Title").innerText()).trim();

  const darlene = await team.as("Darlene");
  await inboxCards(darlene, "open");
  await expect(darlene.getByRole("button", { name: /RAKE Agent export report fails/ })).toBeVisible();
  await expect(darlene.getByRole("button", { name: title })).toHaveCount(0);

  const ref = await confirm(page);
  await inboxCards(darlene, "open");
  await expect(darlene.getByRole("button", { name: new RegExp(ref) })).toBeVisible();
});

test("S04.04 Typing 'yes' instead of pressing Confirm asks for Confirm and saves nothing", async ({ page, signIn }) => {
  await signIn("Rafael");
  await reachCard(page, "The Financial Platform shows an error when I open an invoice");
  const before = (await getJson<unknown[]>(page, "/my/feedback")).length;
  await chatSay(page, "yes");
  await expect(page.getByText("Press Confirm on the summary to send it, or tell me what to change.")).toBeVisible();
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sent\. Your reference is/ })).toHaveCount(0);
  expect(await getJson<unknown[]>(page, "/my/feedback")).toHaveLength(before);
});

test("S04.05 Change, then 'make it P2': Sig asks what to change and a new card shows Major (P2)", async ({ page, signIn }) => {
  await signIn("Mei");
  // Start from Nice-to-have so the change to P2 is visible on the card.
  await reachCard(page, "The Flipbook shows an error when I open a brochure", "Nice-to-have");
  await expect(field(page, "Priority")).toHaveText("Nice-to-have");
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("No worries. What should I change?")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await chatSay(page, "make it P2");
  await expect(card(page)).toBeVisible();
  await expect(field(page, "Priority")).toHaveText("Major");
});

test("S04.06 Change, then 'it's about the Training Portal': the card's Tool changes to Training Portal", async ({ page, signIn }) => {
  await signIn("Aisha");
  await reachCard(page, "The RAKE Agent shows an error when I open a report");
  await expect(field(page, "Tool")).toHaveText("RAKE Agent");
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("No worries. What should I change?")).toBeVisible();
  await chatSay(page, "it's about the Training Portal");
  await expect(card(page)).toBeVisible();
  await expect(field(page, "Tool")).toHaveText("Training Portal");
});

test("S04.07 Confirm shows 'Sent. Your reference is FB-nnnn' and 'It's with Darlene. An Admin will approve it before work starts.'", async ({ page, signIn }) => {
  await signIn("Tom");
  // RAKE Agent is Darlene's (Training Portal is Marc's in the seed).
  await reachCard(page, "The RAKE Agent crashes when I upload a spreadsheet");
  await confirm(page);
  await expect(page.getByText(/It's with Darlene\. An Admin will approve it before work starts\./)).toBeVisible();
});

test("S04.08 The reference is FB- plus four digits, one higher than the last", async ({ page, signIn }) => {
  await signIn("Grace");
  const last = await raiseBug(page, "rake-agent", "RAKE Agent drops my session with an error");
  expect(last).toMatch(/^FB-\d{4}$/);
  await reachCard(page, "The Staff Admin Portal shows an error when I open my timesheet");
  const ref = await confirm(page);
  expect(Number(ref.slice(3))).toBe(Number(last.slice(3)) + 1);
});

test("S04.09 'Track it' opens that reference's tracker; coming back, 'Give more feedback' starts a fresh chat", async ({ page, signIn }) => {
  await signIn("Rafael");
  await reachCard(page, "The IT Asset list shows an error when I open it");
  const ref = await confirm(page);
  await page.getByRole("link", { name: /Track it/ }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
  await expect(page.getByText(ref, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Under review");

  // Back to the chat: the sent screen may or may not still be there; either way the next step is a fresh chat.
  await page.goBack();
  const again = page.getByRole("button", { name: "Give more feedback" });
  const fresh = page.getByText("G'day, I'm Sig.");
  await expect(again.or(fresh)).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(fresh).toBeVisible();
  await expect(page.getByText(/Sent\. Your reference is/)).toHaveCount(0);
  await expect(page.getByLabel("Your message")).toHaveValue("");
});

test("S04.10 Praise is confirmed without approval and its tracker ends on Acknowledged", async ({ page, signIn }) => {
  await signIn("Mei");
  await openChat(page);
  await chatSay(page, "Thanks for the Training Portal update, works great");
  await expect(card(page)).toBeVisible();
  const ref = await confirm(page);
  await expect(page.getByText(/It's with Marc\./)).toBeVisible();
  await expect(page.getByText(/An Admin will approve it/)).toHaveCount(0);

  await page.getByRole("link", { name: /Track it/ }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acknowledged, thank you");
  const acknowledged = page.getByRole("region", { name: "Progress" }).getByRole("listitem").filter({ hasText: "Acknowledged" });
  await expect(acknowledged).toContainText("current stage");
});

test("S04.11 The access-request phrase goes to Chris (routing rule), not Mario", async ({ page, signIn }) => {
  await signIn("Aisha");
  await openChat(page);
  await chatSay(page, "I need access to the Financial Platform");
  await expect(card(page)).toBeVisible();
  await confirm(page);
  await expect(page.getByText(/It's with Chris\./)).toBeVisible();
  await expect(page.getByText(/It's with Mario/)).toHaveCount(0);
});

test("S04.12 'Not sure' to 'Which tool?' goes to the Digital team and sits in Needs review in the console", async ({ page, signIn, team }) => {
  await signIn("Tom");
  await openChat(page);
  await chatSay(page, "The export button is broken and it's annoying");
  await expect(page.getByText("Which tool is this about?")).toBeVisible();
  await page.getByRole("button", { name: "Not sure", exact: true }).click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, EXPECTED);
  await expect(card(page)).toBeVisible();
  const ref = await confirm(page);
  await expect(page.getByText(/It's with the Digital team\./)).toBeVisible();

  const marc = await team.as("Marc");
  await inboxCards(marc, "needs_review");
  const row = marc.getByRole("button", { name: new RegExp(ref) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Needs review");
});

test("S04.13 A P1 (blocking) tells every Admin, Chris, Marc and Mike, 'P1 needs approval'", async ({ page, signIn, team }) => {
  await signIn("Rafael");
  await reachCard(page, "The Training Portal shows an error when I open a course", "Blocking my work");
  await expect(field(page, "Priority")).toHaveText("Blocking");
  const ref = await confirm(page);

  for (const admin of ["Chris", "Marc", "Mike"]) {
    const adminPage = await team.as(admin);
    await adminPage.goto("/console");
    await adminPage.getByRole("button", { name: /^Notifications/ }).click();
    await expect(adminPage.getByRole("link", { name: new RegExp(`P1 needs approval: ${ref}`) }), `${admin} was told`).toBeVisible();
  }
});
