import { expect, resetDatabase, test } from "./fixtures";
import { PNG, getJson, pasteImage, pdf, postJson, raiseBug } from "./helpers";
import type { Page } from "@playwright/test";

// Manual checklist section 9: Staff: reply and reopen. A Resolved item asks the person who raised it
// Is it fixed? (D92): Yes, close it, or I still have an issue, which is the only way it reopens.

test.beforeAll(resetDatabase);

/** Liam raises a plain bug about RAKE Agent (Darlene's) and Marc approves it, so Darlene holds it. */
async function approvedBug(liam: Page, marc: Page, title: string) {
  const ref = await raiseBug(liam, "rake-agent", title);
  await postJson(marc, `/console/items/${ref}/approve`);
  return ref;
}

/** The Conversation on the tracker: one thread, oldest first, the message box under it (D105). */
const conversationOf = (page: Page) => page.locator("section#activity");
const entriesOf = (page: Page) => conversationOf(page).getByRole("listitem");
const messageBox = (page: Page) => page.getByPlaceholder("Write a message or add details");

async function reply(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("S09.01 A message on an open item says who reads it, toasts 'Sent' and is the last entry in the Conversation under You'", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent fails on my phone");

  await page.goto(`/track/${ref}`);
  // Above the box: who reads it, the holder and the approver (D101).
  await expect(conversationOf(page).getByText("Your messages go to Darlene, who has it and Marc, who approved it.")).toBeVisible();
  await reply(page, "It also fails on my phone");

  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(messageBox(page)).toHaveValue("");
  const last = entriesOf(page).last();
  await expect(last).toContainText("Liam Carter");
  await expect(last).toContainText("You");
  await expect(last).toContainText("It also fails on my phone");
});

test("S09.02 Darlene sees New reply on the card and a bell notification that Liam replied", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const darlene = await team.as("Darlene");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent prints blank pages");
  await page.goto(`/track/${ref}`);
  await reply(page, "It happens every time");
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();

  // New reply is only on the card, so the item panel stays closed. A real <button>
  // is picked because the board's drag wrapper is a second element with role "button".
  await darlene.goto("/console");
  const card = darlene.locator("button", { hasText: ref });
  await expect(card.getByText("New reply", { exact: true })).toBeVisible();

  await darlene.getByRole("button", { name: /^Notifications/ }).click();
  await expect(darlene.getByText(`${ref}: Liam Carter replied`)).toBeVisible();
});

/** The same, started and resolved by Darlene. */
async function resolvedBug(liam: Page, team: { as: (first: string) => Promise<Page> }, title: string) {
  const ref = await approvedBug(liam, await team.as("Marc"), title);
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${ref}/start`);
  await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Fix deployed" });
  return ref;
}

const question = (page: Page, name = "Is it fixed?") => page.getByRole("region", { name });

test("S09.03 On a Resolved item a message no longer reopens it: it stays Resolved and shows in the Conversation under You'", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await resolvedBug(page, team, "RAKE Agent loses my filters");

  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");
  await expect(page.getByText("Replying reopens it.")).toHaveCount(0);
  await reply(page, "Thanks, I'll check it on my phone tonight");

  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");
  const last = entriesOf(page).last();
  await expect(last).toContainText("Thanks, I'll check it on my phone tonight");
  await expect(last).toContainText("You");
  await expect(conversationOf(page)).not.toContainText("Reopened");
  await expect(question(page)).toBeVisible();
});

test("S09.04 A Closed or Declined item has no message box", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const marc = await team.as("Marc");
  const darlene = await team.as("Darlene");

  const closed = await approvedBug(page, marc, "RAKE Agent should whistle on start-up");
  await postJson(darlene, `/console/items/${closed}/close`, { reason: "Done", ending: "no_longer_needed" });
  await page.goto(`/track/${closed}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No longer needed");
  await expect(messageBox(page)).toHaveCount(0);

  const declined = await raiseBug(page, "rake-agent", "RAKE Agent should print on gold paper");
  await postJson(marc, `/console/items/${declined}/decline`, { reason: "Not now" });
  await page.goto(`/track/${declined}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Declined");
  await expect(messageBox(page)).toHaveCount(0);
});

test("S09.07 Is it fixed? on a Resolved item: Yes, close it ends it as Fixed by Liam, and Darlene is told", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await resolvedBug(page, team, "RAKE Agent forgets my language");
  await page.goto(`/track/${ref}`);
  await expect(question(page)).toContainText(/it closes as fixed on [A-Z][a-z]{2},? \d{1,2} [A-Z][a-z]{2}/);
  await question(page).getByRole("button", { name: "Yes, close it" }).click();

  await expect(page.getByText("Closed as fixed. Thanks for letting us know.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixed");
  await expect(entriesOf(page).last()).toContainText("Liam Carter confirmed it's fixed");
  // The question becomes Still not right?, with I still have an issue only.
  await expect(question(page, "Still not right?").getByRole("button")).toHaveText(["I still have an issue"]);

  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await darlene.getByRole("button", { name: /^Notifications/ }).click();
  await expect(darlene.getByText(`${ref}: Liam Carter confirmed it's fixed`)).toBeVisible();
});

test("S09.08 I still have an issue needs words, takes a screenshot, and sends it back to Darlene in progress; she is told", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await resolvedBug(page, team, "RAKE Agent hides my saved answers");
  await page.goto(`/track/${ref}`);
  await question(page).getByRole("button", { name: "I still have an issue" }).click();
  const box = page.getByLabel("What's still wrong?");
  await expect(box).toBeFocused();
  await question(page).getByRole("button", { name: "Send it back" }).click();
  await expect(question(page).getByRole("alert")).toHaveText("Say what is still wrong.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");

  await box.fill("Still empty on my phone");
  await page.locator("#still-wrong-file").setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: PNG });
  await expect(question(page)).toContainText("phone.png");
  await question(page).getByRole("button", { name: "Send it back" }).click();

  await expect(page.getByText("Thanks. It's back with the owner.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Being worked on");
  await expect(question(page)).toHaveCount(0);
  await expect(conversationOf(page).getByText("In this conversation").locator("..")).toContainText("Darlene");
  await expect(page.getByRole("region", { name: "What you sent" }).getByRole("img", { name: "phone.png" })).toBeVisible();
  await expect(entriesOf(page).filter({ hasText: "Reopened: Liam Carter still has an issue" })).toHaveCount(1);
  await expect(conversationOf(page)).toContainText("Still empty on my phone");

  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await darlene.getByRole("button", { name: /^Notifications/ }).click();
  // One bell row per item (D78): the screenshot came last, and Reopened is a step in its trail.
  await expect(darlene.getByRole("link", { name: new RegExp(`${ref}: Liam Carter added a file`) })).toContainText(/Steps so far: .*Reopened/);
});

test("S09.09 After Yes, close it, I still have an issue reopens a Fixed item until the date shown, and the message box is back", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await resolvedBug(page, team, "RAKE Agent shows last week's roster");
  await postJson(page, `/feedback/${ref}/fixed`);
  await page.goto(`/track/${ref}`);
  const until = (await getJson<{ is_it_fixed: { reopen_until: string } }>(page, `/feedback/${ref}/tracker`)).is_it_fixed.reopen_until;
  const shown = new Date(until).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  await expect(question(page, "Still not right?")).toContainText(`You can send it back to the team until ${shown}.`);
  await expect(messageBox(page)).toHaveCount(0);

  await question(page, "Still not right?").getByRole("button", { name: "I still have an issue" }).click();
  await page.getByLabel("What's still wrong?").fill("It's back to last week's roster");
  await question(page, "Still not right?").getByRole("button", { name: "Send it back" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Being worked on");
  await expect(messageBox(page)).toBeVisible();
});

test("S09.10 The email's answers open the tracker ready: ?fixed=yes focuses Yes, close it and ?fixed=no opens What's still wrong?", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await resolvedBug(page, team, "RAKE Agent mixes up my shifts");
  await page.goto(`/track/${ref}?fixed=yes`);
  await expect(question(page).getByRole("button", { name: "Yes, close it" })).toBeFocused();
  // Opening the link changes nothing by itself.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");

  await page.goto(`/track/${ref}?fixed=no`);
  await expect(page.getByLabel("What's still wrong?")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resolved");
});

test("S09.05 Darlene replying on Liam's tracker is refused with 'Reply from the console instead.'", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent drops my session");

  const darlene = await team.as("Darlene");
  await darlene.goto(`/track/${ref}`);
  await reply(darlene, "Trying to reply from here");

  await expect(darlene.getByRole("alert").filter({ hasText: "Reply from the console instead." })).toBeVisible();
  await expect(darlene.getByText("Sent", { exact: true })).toHaveCount(0);

  // Nothing was added to Liam's Conversation.
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planned, not started yet");
  await expect(conversationOf(page)).not.toContainText("Trying to reply from here");
});

test("S09.06 A screenshot pasted into the message box shows as a thumbnail with the passwords line, then under What you sent", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await approvedBug(page, await team.as("Marc"), "RAKE Agent export page shows an error");
  await page.goto(`/track/${ref}`);

  await pasteImage(messageBox(page));
  await page.getByTestId("reply-files").setInputFiles(pdf("steps.pdf"));
  const shot = page.getByRole("img", { name: /^Screenshot \d\d\.\d\d\.\d\d\.png$/ });
  await expect(shot).toBeVisible();
  await expect(page.getByText(/steps\.pdf · \d+ KB/)).toBeVisible();
  await expect(page.getByText("Check it doesn't show passwords or card numbers.")).toBeVisible();
  await reply(page, "Here's the error I get");

  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(page.getByText("Check it doesn't show passwords or card numbers.")).toHaveCount(0);
  const sent = page.getByRole("region", { name: "What you sent" });
  const thumbnail = sent.getByRole("img", { name: /^Screenshot / });
  await expect(thumbnail).toBeVisible();
  // The thumbnail is the real file, served through its signed link.
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(sent.getByRole("link", { name: /steps\.pdf/ })).toBeVisible();
});
