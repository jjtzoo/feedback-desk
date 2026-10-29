import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { BUG, BUG_ANSWERS, confirmApprove, getJson, openActivity, postJson, raise, raiseBug, statusMoves } from "./helpers";

// Manual checklist section 18: Admin approvals (/console/approvals). Staff raise feedback through the
// API, Admins decide it on the screen, and the staff member's tracker and bell are read afterwards.
// RAKE Agent items are Darlene's, Training Portal and Flipbook items are Marc's.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };

const EXPECTED = "I expected it to open but got a blank screen";
const TIME = /\d{1,2}:\d{2}/;

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
/** A row in the open bell, found by the words in its title. */
const row = (page: Page, text: RegExp) => page.getByRole("link", { name: text });

/** One waiting card on the Approvals page, found by its reference link. */
const approval = (page: Page, ref: string) => page.getByRole("article").filter({ has: page.getByRole("link", { name: ref, exact: true }) });

async function openApprovals(page: Page) {
  await page.goto("/console/approvals");
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
}

/** The console's board, which lists only the person's own items (the default inbox), in Board view. */
async function openBoard(page: Page, query = "") {
  const saved = await page.request.put("/api/console/view", { data: { view: "board" } });
  expect(saved.ok(), `PUT /console/view -> ${saved.status()}`).toBeTruthy();
  await page.goto(`/console${query}`);
}

const column = (page: Page, title: string) => page.getByRole("region", { name: new RegExp(`^${title}, \\d+ items$`) });
/** A real <button>, because the board's drag wrapper is a second element with role "button". */
const boardCard = (region: Locator, ref: string) => region.locator("button", { hasText: ref });

/** Raise a plain RAKE Agent bug (Darlene's) as a staff member, at the usual Major priority. */
async function raiseRake(page: Page, title: string) {
  return raiseBug(page, "rake-agent", title);
}

/** Raise a blocking bug (P1) about a tool. */
async function raiseBlocking(page: Page, project: string, title: string) {
  return raise(page, title, ["Blocking my work", EXPECTED], project);
}

// One item that is never decided, so a page with only that item left proves the list had loaded
// before a test says an item is gone. Built once, by whichever test needs it first.
let controlRef: Promise<string> | null = null;
function control(team: Team) {
  controlRef ??= (async () => raiseBug(await team.as("Tom"), "flipbook", "The Flipbook shows an error when I open the control brochure"))();
  return controlRef;
}

/** Drag a board card onto a column the way a person does: press, pass the drag threshold, move, release. */
async function dragTo(page: Page, card: Locator, target: Locator) {
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 12, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
}

test("S18.01 Approvals lists waiting items P1 first with a red outline, each with its details and the recommendation", async ({ page, signIn, team }) => {
  const minor = await raiseRake(await team.as("Liam"), "The RAKE Agent history page shows an error when I open it");
  const title = "The Training Portal course page shows an error when I open it";
  const urgent = await raiseBlocking(await team.as("Aisha"), "training-portal", title);

  await signIn("Chris");
  await openApprovals(page);
  await expect(approval(page, urgent)).toBeVisible();
  await expect(approval(page, minor)).toBeVisible();

  // P1 first: the list runs P1 to P4, and the blocking item heads it although it was raised second.
  const texts = await page.getByRole("article").allInnerTexts();
  const ranks = texts.map((t) => Number(/P(\d) ·/.exec(t)![1]));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  expect(texts[0]).toContain(urgent);
  expect(texts.findIndex((t) => t.includes(minor))).toBeGreaterThan(0);

  // The red outline is the P1 badge's border; the P2 badge has none.
  await expect(approval(page, urgent).getByText("P1 · Blocking")).toHaveClass(/border-primary/);
  await expect(approval(page, minor).getByText("P2 · Major")).not.toHaveClass(/border-primary/);

  const card = approval(page, urgent);
  await expect(card.getByRole("link", { name: urgent, exact: true })).toHaveAttribute("href", new RegExp(`item=${urgent}$`));
  await expect(card).toContainText("Awaiting approval");
  await expect(card.getByRole("heading", { level: 2 })).toContainText(title);
  await expect(card).toContainText(/Fix · Training Portal · .+ · from Aisha Rahman/);
  // Who has it, and why routing chose them (D56).
  await expect(card).toContainText("Auto-assigned to Marc · owner of Training Portal");
  await expect(card.locator("p").filter({ hasText: title }).first()).toBeVisible();
  await expect(card).toContainText("Implement: Raised by staff; see the brief. Effort: small. Affects one person.");
  for (const name of ["Approve", "Decline"]) await expect(card.getByRole("button", { name, exact: true })).toBeVisible();
  // A question is a message in the item's Conversation, so it is a link there, not a button (D105).
  await expect(card.getByRole("link", { name: "Ask a question", exact: true })).toHaveAttribute("href", `/console?item=${urgent}&tab=activity`);
  await expect(card.getByRole("button", { name: "Ask for info" })).toHaveCount(0);
});

test("S18.02 Approve takes it off the list into Darlene's Approved column; the tracker shows Planned (Chris accepted it) and Darlene is told", async ({
  page,
  signIn,
  team,
}) => {
  const liam = await team.as("Liam");
  const ref = await raiseRake(liam, "The RAKE Agent export page shows an error when I open it");
  await signIn("Chris");
  await openApprovals(page);
  await expect(approval(page, ref)).toBeVisible();

  await approval(page, ref).getByRole("button", { name: "Approve", exact: true }).click();
  await confirmApprove(page, ref);
  await expect(page.getByText(`${ref} approved`)).toBeVisible();
  await expect(approval(page, ref)).toHaveCount(0);

  const darlene = await team.as("Darlene");
  await openBoard(darlene);
  await expect(boardCard(column(darlene, "Approved"), ref)).toBeVisible();

  // The tracker has reached Approved: the heading, the stage and the history entry say so.
  await liam.goto(`/track/${ref}`);
  await expect(liam.getByRole("heading", { level: 1 })).toHaveText("Planned, not started yet");
  const stages = liam.getByRole("region", { name: "Progress" }).getByRole("listitem");
  await expect(stages.nth(0)).toContainText(", done");
  await expect(stages.nth(1)).toContainText("Planned");
  await expect(stages.nth(1)).toContainText(", current stage");
  await expect(liam.locator("section#activity").getByRole("listitem").filter({ hasText: "Planned (Chris accepted it)" })).toBeVisible();

  await darlene.goto("/console");
  await bell(darlene).click();
  await expect(row(darlene, new RegExp(`Approved, ready to start: ${ref}`))).toBeVisible();
});

test("S18.03 As Mike, the item Chris approved is gone from Approvals", async ({ page, signIn, team }) => {
  const ref = await raiseRake(await team.as("Aisha"), "The RAKE Agent print page shows an error when I open it");
  const waiting = await control(team);

  await signIn("Mike");
  await openApprovals(page);
  await expect(approval(page, ref)).toBeVisible();

  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await page.reload();
  await expect(approval(page, waiting)).toBeVisible();
  await expect(approval(page, ref)).toHaveCount(0);
});

test("S18.04 Decline needs a reason, then closes the item, shows the reason on the tracker and notifies Mario", async ({ page, signIn, team }) => {
  const mario = await team.as("Mario");
  const ref = await raiseRake(mario, "The RAKE Agent search page shows an error when I open it");
  const reason = "Out of scope for this quarter, please raise it again in January";

  await signIn("Chris");
  await openApprovals(page);
  await approval(page, ref).getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Decline" })).toBeVisible();

  // No reason: the dialog stays, says so, and the item is still waiting.
  await dialog.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(dialog.getByText("Reason is needed.")).toBeVisible();
  await expect(dialog).toBeVisible();
  // The open dialog hides the page from the accessibility tree, so the card is found by its text here.
  await expect(page.locator("article", { hasText: ref })).toBeVisible();

  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByText(`${ref} declined`)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(approval(page, ref)).toHaveCount(0);

  await mario.goto(`/track/${ref}`);
  await expect(mario.getByRole("heading", { level: 1 })).toHaveText("Declined");
  await expect(mario.getByText(`Reason: ${reason}`)).toBeVisible();
  await bell(mario).click();
  await expect(row(mario, new RegExp(`${ref} was declined`))).toBeVisible();
});

test("S18.05 Ask a question opens the item's Conversation, and a reply there sends the question while the item stays in Approvals", async ({ page, signIn, team }) => {
  const ref = await raiseRake(await team.as("Tom"), "The RAKE Agent upload page shows an error when I open it");
  await signIn("Chris");
  await openApprovals(page);
  await approval(page, ref).getByRole("link", { name: "Ask a question", exact: true }).click();

  // The panel opens on the Conversation tab; a message there starts as an internal note, so switch to the reply.
  await expect(page).toHaveURL(new RegExp(`/console\\?item=${ref}&tab=activity`));
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("radio", { name: /^Reply to Tom/ }).click();
  await panel.getByLabel("Message to Tom (they'll see it)").fill("Which upload were you trying when the error showed?");
  await panel.getByRole("button", { name: "Send to Tom", exact: true }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "Which upload were you trying when the error showed?" })).toBeVisible();

  await openApprovals(page);
  await expect(approval(page, ref)).toContainText("Awaiting approval");
});

test("S18.06 The person who raised it gets a bell notification with the question, and the tracker shows it from Chris in the Conversation", async ({ team }) => {
  // Under Docker the same question is also emailed (Mailpit); not checked here.
  const question = "Which certificate were you opening when the error showed?";
  const aisha = await team.as("Aisha");
  const ref = await raiseRake(aisha, "The RAKE Agent report page shows an error when I open it");
  await postJson(await team.as("Chris"), `/console/items/${ref}/reply`, { body: question });

  await aisha.goto("/my");
  await bell(aisha).click();
  const notice = row(aisha, new RegExp(`Chris replied on ${ref}`));
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(question.slice(0, 30));

  await notice.click();
  await expect(aisha).toHaveURL(new RegExp(`/track/${ref}#latest$`)); // at the newest entry (D81)
  const entry = aisha.locator("section#activity").getByRole("listitem").filter({ hasText: question });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Chris");
});

test("S18.07 The submitter's answer in the message box toasts 'Sent' and reaches Chris's Conversation tab", async ({
  page,
  signIn,
  team,
}) => {
  const answer = "It was the certificate for the fire warden course";
  const aisha = await team.as("Aisha");
  const ref = await raiseRake(aisha, "The RAKE Agent summary page shows an error when I open it");
  await postJson(await team.as("Chris"), `/console/items/${ref}/reply`, { body: "Which course was it?" });

  await aisha.goto(`/track/${ref}`);
  await aisha.getByPlaceholder("Write a message or add details").fill(answer);
  await aisha.getByRole("button", { name: "Send", exact: true }).click();
  await expect(aisha.getByText("Sent", { exact: true })).toBeVisible();

  await signIn("Chris");
  await page.goto(`/console?inbox=open&item=${ref}`);
  const panel = page.getByRole("dialog");
  await openActivity(panel);
  const entry = panel.getByRole("listitem").filter({ hasText: answer });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("Aisha Rahman");
});

test("S18.08 As Marc, approving works from the item panel and from the board's Awaiting approval column", async ({ page, signIn, team }) => {
  const [panelRef, boardRef] = [
    await raiseBug(await team.as("Tom"), "training-portal", "The Training Portal exam page shows an error when I open it"),
    await raiseBug(await team.as("Rafael"), "training-portal", "The Training Portal results page shows an error when I open it"),
  ];

  await signIn("Marc");
  // His own inbox keeps the board short enough to drag across; an Admin's default is All open, which is taller than the window.
  await openBoard(page, "?inbox=mine");
  const awaiting = column(page, "Awaiting approval");
  await expect(boardCard(awaiting, panelRef)).toBeVisible();
  await expect(boardCard(awaiting, boardRef)).toBeVisible();

  // From the panel.
  await boardCard(awaiting, panelRef).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(panelRef, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Approve", exact: true }).click();
  await confirmApprove(page, panelRef);
  await expect(panel.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  expect(await statusMoves(page, panel)).toContain("Start work");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(boardCard(column(page, "Approved"), panelRef)).toBeVisible();
  await expect(boardCard(column(page, "Awaiting approval"), panelRef)).toHaveCount(0);

  // From the board: the card is dragged from Awaiting approval to Approved.
  await dragTo(page, boardCard(column(page, "Awaiting approval"), boardRef), column(page, "Approved"));
  await expect(boardCard(column(page, "Approved"), boardRef)).toBeVisible();
  await expect(boardCard(column(page, "Awaiting approval"), boardRef)).toHaveCount(0);
});

test("S18.09 The History tab of an approved and a declined item shows who, when and the reason", async ({ page, signIn, team }) => {
  const approved = await raiseRake(await team.as("Liam"), "The RAKE Agent settings page shows an error when I open it");
  const declined = await raiseRake(await team.as("Grace"), "The RAKE Agent profile page shows an error when I open it");
  const reason = "Duplicate of work already planned for next month";
  const chris = await team.as("Chris");
  await postJson(chris, `/console/items/${approved}/approve`);
  await postJson(chris, `/console/items/${declined}/decline`, { reason });

  await signIn("Chris");
  for (const [ref, text] of [
    [approved, "Approved"],
    [declined, `Declined: ${reason}`],
  ]) {
    await page.goto(`/console?inbox=open&item=${ref}`);
    const panel = page.getByRole("dialog");
    await openActivity(panel);
    const entry = panel.getByRole("listitem").filter({ hasText: text });
    await expect(entry, ref).toBeVisible();
    await expect(entry).toContainText(`Chris · ${text}`);
    await expect(entry.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
    await expect(entry.locator("time")).toHaveText(TIME);
  }
});

test("S18.10 Praise items never appear in Approvals", async ({ page, signIn, team }) => {
  const praise = await raise(await team.as("Mei"), "Thanks for the Training Portal update, works great");
  const waiting = await control(team);

  await signIn("Chris");
  await openApprovals(page);
  await expect(approval(page, waiting)).toBeVisible();
  await expect(approval(page, praise)).toHaveCount(0);
});

test("S18.11 A plain bug waits in Approvals, and its owner can't start it until it is approved", async ({ page, signIn, team }) => {
  const ref = await raise(await team.as("Liam"), BUG, BUG_ANSWERS);

  await signIn("Chris");
  await openApprovals(page);
  await expect(approval(page, ref)).toBeVisible();
  await expect(approval(page, ref)).toContainText("Awaiting approval");
  await expect(approval(page, ref)).toContainText("Auto-assigned to Marc · owner of Training Portal");

  // Marc owns the Training Portal: the API refuses to start it, and the panel offers no Start work.
  const marc = await team.as("Marc");
  const started = await marc.request.post(`/api/console/items/${ref}/start`, { data: {} });
  expect(started.status()).toBe(409);
  expect(await started.text()).toContain("Only approved items can be started");
  await marc.goto(`/console?inbox=open&item=${ref}`);
  const panel = marc.getByRole("dialog");
  await expect(panel.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  expect(await statusMoves(marc, panel)).not.toContain("Start work");

  await panel.getByRole("button", { name: "Approve", exact: true }).click();
  await confirmApprove(marc, ref);
  await expect(panel.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  expect(await statusMoves(marc, panel)).toContain("Start work");
});

test("S18.12 The abuse phrase is not assigned to Darlene, sits in Needs review as Flagged, and every Admin is told", async ({ page, signIn, team }) => {
  const ref = await raise(await team.as("Mario"), "Darlene is useless, the RAKE agent keeps crashing", [
    "Slowing me down",
    "I expected it to stay up but it crashed",
  ]);

  await signIn("Chris");
  await openApprovals(page);
  await expect(approval(page, ref)).toContainText("Needs review");
  await expect(approval(page, ref)).toContainText("Nobody has it yet · flagged for the Admins");
  await expect(approval(page, ref)).not.toContainText("Auto-assigned to Darlene");

  await openBoard(page, "?inbox=needs_review");
  const flagged = boardCard(column(page, "Needs review"), ref);
  await expect(flagged).toBeVisible();
  await expect(flagged).toContainText("Flagged");

  // Darlene's own items (the default inbox) do not include it.
  const darlene = await team.as("Darlene");
  await openBoard(darlene, "?inbox=mine");
  await expect(column(darlene, "In progress")).toBeVisible();
  await expect(boardCard(darlene.getByRole("region"), ref)).toHaveCount(0);

  for (const admin of ["Chris", "Marc", "Mike"]) {
    const adminPage = await team.as(admin);
    await adminPage.goto("/console");
    await bell(adminPage).click();
    await expect(row(adminPage, new RegExp(`Flagged feedback needs an Admin: ${ref}`)), `${admin} was told`).toBeVisible();
  }
});

test("S18.13 The dashboard's Waiting for approval shows the count and, in amber, how many have waited over 2 business days", async ({
  page,
  signIn,
  team,
}) => {
  await control(team);
  await signIn("Chris");
  const stat = page.getByText("Waiting for approval", { exact: true }).locator("..");
  const value = stat.locator("p").nth(1);
  await page.goto("/console/dashboard");
  await expect(stat).toBeVisible();
  const before = Number(await value.innerText());
  expect(before).toBeGreaterThan(0);

  // The count follows the queue: one more waiting, then it is approved.
  const ref = await raiseRake(await team.as("Rafael"), "The RAKE Agent calendar page shows an error when I open it");
  await page.reload();
  await expect(value).toHaveText(String(before + 1));
  await postJson(page, `/console/items/${ref}/approve`);
  await page.reload();
  await expect(value).toHaveText(String(before));

  // Nothing has waited that long yet, so there is no note.
  await expect(stat).not.toContainText("over 2 business days");

  // An item can't be made two business days old through the app, so the dashboard's own answer is
  // given a count here: this checks how the page shows it (the note, and amber), not the server's sum.
  const real = await getJson<{ approvals_over_2_days: number }>(page, "/console/dashboard");
  expect(real.approvals_over_2_days).toBe(0);
  await page.route("**/api/console/dashboard", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), approvals_over_2_days: 2 } });
  });
  await page.reload();
  await expect(stat.getByText("2 over 2 business days")).toHaveClass(/text-warning/);
  await expect(value).toHaveText(String(before));
});

test("S18.14 Approve opens a dialog with the priority, a due date and instructions; Darlene gets the instructions with the approval, pinned on the item, and the tracker never shows them", async ({ page, signIn, team }) => {
  const liam = await team.as("Liam");
  const ref = await raiseRake(liam, "The RAKE Agent leave answers are blank on Mondays");
  const instructions = "Check the leave index first; don't change the prompt.";
  await signIn("Chris");
  await openApprovals(page);
  await approval(page, ref).getByRole("button", { name: "Approve", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: `Approve ${ref}`, exact: true });
  const priority = dialog.getByRole("combobox", { name: "Priority" });
  await expect(priority).toHaveText("P2 · Major");
  await priority.click();
  await page.getByRole("option", { name: "P1 · Blocking" }).click();
  await dialog.locator("#approve-due").click();
  await page.getByRole("grid").locator("button:not([disabled])").last().click();
  await expect(dialog.locator("#approve-due")).not.toHaveText("Pick a date");
  await dialog.getByRole("textbox", { name: "Instructions for the developer (optional)" }).fill(instructions);
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(`${ref} approved`)).toBeVisible();
  const item = await getJson<{ priority: string; expected_by: string | null }>(page, `/console/items/${ref}`);
  expect(item.priority).toBe("P1");
  expect(item.expected_by).not.toBeNull();

  // Darlene, who has it: told with the approval, and the instructions pinned at the top of the panel.
  const darlene = await team.as("Darlene");
  const told = (await getJson<{ items: { title: string; body: string }[] }>(darlene, "/notifications")).items.find((n) => n.title.startsWith(`Approved, ready to start: ${ref}`));
  expect(told?.body).toBe(`Instructions from Chris: ${instructions}`);
  await darlene.goto(`/console?item=${ref}`);
  const panel = darlene.getByRole("dialog");
  await openActivity(panel);
  // Pinned above the rest of the Conversation, internal, from Chris at approval; written there once.
  const pinned = panel.getByRole("listitem").first();
  await expect(pinned).toContainText("Chris");
  await expect(pinned).toContainText("at approval");
  await expect(pinned).toContainText("Internal · pinned");
  await expect(pinned).toContainText(instructions);
  await expect(panel.getByRole("listitem").filter({ hasText: instructions })).toHaveCount(1);

  // Liam sees the date as Expected by, and never the instructions.
  await liam.goto(`/track/${ref}`);
  await expect(liam.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(liam.getByRole("main")).toContainText("Expected by");
  await expect(liam.getByRole("main")).not.toContainText("leave index");
});
