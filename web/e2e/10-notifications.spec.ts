import { type Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, postJson, raise, raiseBug, statusMoves } from "./helpers";

// Manual checklist section 10: the bell, what raises a notification, and muting an item.
// Liam stands in for Mario (the person who raised it); RAKE Agent is Darlene's, so she is assigned.

test.beforeAll(resetDatabase);

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const openBell = (page: Page) => bell(page).click();

/** Mark everything read through the API, so a test starts from an empty count. */
const clearBell = (page: Page) => postJson(page, "/notifications/read");

/** The bell's row for an item, found by the words in its title. */
const row = (page: Page, text: RegExp) => page.getByRole("link", { name: text });
/** The same, only inside the open bell, for pages that also link to the item (My feedback). */
const bellRow = (page: Page, text: RegExp) => page.locator("[data-slot=popover-content]").getByRole("link", { name: text });

test("S10.01 A bell in the staff header and the console header, with an unread count", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I upload a large file");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);

  // Staff header: Liam was told it is planned.
  await page.goto("/my");
  await expect(page.getByRole("banner").getByRole("button", { name: /^Notifications, \d+ unread$/ })).toBeVisible();

  // Console header: Darlene was told it is assigned to her.
  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await expect(darlene.getByRole("banner").getByRole("button", { name: /^Notifications, \d+ unread$/ })).toBeVisible();
});

test("S10.02 Mario's bell count rises within a few seconds without a refresh", async ({ page, signIn, team }) => {
  await signIn("Liam");
  await clearBell(page);
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent freezes when I search the policy library");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  const darlene = await team.as("Darlene");

  // Recorded, not waited for: waiting on the stream would turn the bug into a setup timeout.
  let encoding = "not seen";
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/notifications/stream") encoding = r.headers()["content-encoding"] ?? "identity";
  });
  // Post only after the bell's first load, so that load cannot pick up the update instead of the stream.
  const firstList = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/notifications" && r.request().method() === "GET");
  await page.goto(`/track/${ref}`);
  await (await firstList).finished();
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");

  // A reload or navigation would wipe this mark.
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.evaluate(() => {
    (window as Window & { s1002?: string }).s1002 = "same page";
  });

  await postJson(darlene, `/console/items/${ref}/update`, { body: "We reproduced it and are working on a fix" });

  // The API checks every 3 s (STREAM_CHECK_SECONDS). 8 s is "a few seconds" with margin and well
  // under the 30 s polling fallback, so only the live stream can pass this.
  test.info().annotations.push({ type: "stream content-encoding", description: encoding });
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread", { timeout: 8_000 });
  expect(await page.evaluate(() => (window as Window & { s1002?: string }).s1002)).toBe("same page");
  expect(navigations).toBe(0);
  await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
});

test("S10.03 Clicking a notification opens the tracker and the item turns read", async ({ page, signIn, team }) => {
  await signIn("Liam");
  await clearBell(page);
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent drops my session after ten minutes");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);

  await page.goto("/my");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await openBell(page);
  const approved = row(page, new RegExp(`${ref} is planned`));
  await expect(approved).toHaveAccessibleName(/Unread/);
  await approved.click();

  await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await openBell(page);
  await expect(approved).not.toHaveAccessibleName(/Unread/);
});

test("S10.04 Clicking an 'assigned to you' notification opens the console with that item's panel", async ({ page, signIn, team }) => {
  const title = "RAKE Agent shows the wrong date on the summary";
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", title);

  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await openBell(darlene);
  await row(darlene, new RegExp(`New feedback assigned to you: ${ref}`)).click();

  await expect(darlene).toHaveURL(new RegExp(`/console\\?.*item=${ref}`));
  await expect(darlene.getByRole("dialog", { name: title })).toBeVisible();
});

test("S10.05 Mark all read clears the count", async ({ page, signIn, team }) => {
  await signIn("Liam");
  await clearBell(page);
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent logs me out of the console");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${ref}/start`);

  await page.goto("/my");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
  await openBell(page);
  await page.getByRole("button", { name: "Mark all read" }).click();

  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
  await expect(row(page, new RegExp(`${ref} is being worked on`))).not.toHaveAccessibleName(/Unread/);
});

test("S10.06 Approve, start, update, reply, resolve and close each notify the person who raised it", async ({ page, signIn, team }) => {
  await signIn("Liam");
  await clearBell(page);
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I upload a large file");
  const darlene = await team.as("Darlene");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  await postJson(darlene, `/console/items/${ref}/start`);
  await postJson(darlene, `/console/items/${ref}/update`, { body: "Found the cause, the fix is in testing" });
  await postJson(darlene, `/console/items/${ref}/reply`, { body: "Which file were you uploading?" });
  await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Fix deployed to production" });
  // Digital Staff can't close a resolved item; an Admin closes it for them, so they still hear Fixed (D92).
  await postJson(await team.as("Marc"), `/console/items/${ref}/close`, { reason: "Confirmed working on the phone", ending: "fixed" });

  await page.goto("/my");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 6 unread");
  await openBell(page);
  // One row for the item (D78): the latest on top and every step under it.
  const item = bellRow(page, new RegExp(ref));
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`${ref} is fixed`);
  await expect(item).toContainText("Steps so far: Planned, then In progress, then Update, then Reply, then Resolved, then Fixed");
});

test("S10.07 A new item notifies the owner on assignment and again when the submitter replies", async ({ page, signIn, team }) => {
  const darlene = await team.as("Darlene");
  await clearBell(darlene);
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent drops my session after ten minutes");

  await page.goto(`/track/${ref}`);
  await page.getByPlaceholder("Write a message or add details").fill("It also happens on my phone");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();

  await darlene.goto("/console");
  await expect(bell(darlene)).toHaveAccessibleName("Notifications, 2 unread");
  await openBell(darlene);
  // One row for the item (D78): the reply on top, the assignment before it.
  const item = row(darlene, new RegExp(`${ref}: Liam Carter replied`));
  await expect(item).toBeVisible();
  await expect(item).toContainText("Steps so far: Assigned, then Reply");
});

test("S10.08 Mute stops notifications for the item and Unmute brings them back", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent shows the wrong date on the summary");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  await clearBell(page);
  const darlene = await team.as("Darlene");

  await page.goto(`/track/${ref}`);
  await page.getByRole("button", { name: "Mute notifications for this item" }).click();
  await expect(page.getByText(/^Muted\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Unmute this item" })).toBeVisible();

  // Muted: the update raises nothing. The approval row proves the list had loaded.
  await postJson(darlene, `/console/items/${ref}/update`, { body: "First update while muted" });
  await page.reload();
  await openBell(page);
  await expect(row(page, new RegExp(`${ref} is planned`))).toBeVisible();
  await expect(row(page, new RegExp(`Update on ${ref}`))).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName("Notifications");

  // Unmuted: the next update arrives.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unmute this item" }).click();
  await expect(page.getByText("Notifications are back on for this item.")).toBeVisible();
  await postJson(darlene, `/console/items/${ref}/update`, { body: "Second update after unmuting" });
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await openBell(page);
  await expect(row(page, new RegExp(`Update on ${ref}`))).toBeVisible();
});

test("S10.09 Under Docker, Mailpit holds one email per notification", async () => {
  test.skip(true, "Not automated: needs Docker and Mailpit, and this machine has no Docker (no Docker Desktop, no WSL distro); the browser tests run with email off");
});

test("S10.10 Once Chris approves a P1, Mike's 'P1 needs approval' turns read and reads 'approved by Chris', with an Approved badge", async ({ page, signIn, team }) => {
  await signIn("Mike");
  await clearBell(page);
  const ref = await raise(await team.as("Liam"), "RAKE Agent gives a blank answer when I ask about leave.", ["It's blocking my work", "I expected an answer about leave, but got an empty box"], "rake-agent");
  await page.goto("/console");
  await openBell(page);
  const asked = row(page, new RegExp(`P1 needs approval: ${ref}`));
  await expect(asked).toContainText("Awaiting approval");
  await expect(asked).toContainText("Unread");

  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await page.reload();
  await openBell(page);
  const settled = row(page, new RegExp(`${ref} approved by Chris`));
  await expect(settled).toContainText("Approved");
  await expect(settled).not.toContainText("Unread");
  await expect(row(page, new RegExp(`P1 needs approval: ${ref}`))).toHaveCount(0);
  // Mike doesn't hold it, so its Status menu offers no Start work (D91).
  await settled.click();
  await expect(page.getByRole("dialog").getByText(ref, { exact: true })).toBeVisible();
  expect(await statusMoves(page, page.getByRole("dialog"))).toEqual(["Close…"]);
});

test("S10.11 Each notification's badge shows the item's stage now, for the owner and for the person who raised it", async ({ page, signIn, team }) => {
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent drops my last message after a refresh");
  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await openBell(darlene);
  // The item's one row (D78): "assigned to you" now, "ready to start" once approved.
  const assigned = row(darlene, new RegExp(ref));
  await expect(assigned).toContainText("New feedback assigned to you");
  await expect(assigned).toContainText("Awaiting approval");

  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await darlene.reload();
  await openBell(darlene);
  await expect(assigned).toContainText("Approved");

  await postJson(darlene, `/console/items/${ref}/start`);
  await page.goto("/my");
  await openBell(page);
  // Liam's "is planned" was sent at stage 2; it now says where the item is.
  const planned = bellRow(page, new RegExp(ref));
  await expect(planned).toContainText("Planned, then In progress");
  await expect(planned).toContainText("In progress");
});

test("S10.12 Each Admin has one standing 'N items waiting for your approval' row that follows the count and goes at zero", async ({ page, signIn, team }) => {
  // Start from an empty queue: earlier tests in this file leave items waiting.
  const chris = await team.as("Chris");
  for (const item of await getJson<{ reference: string }[]>(chris, "/console/approvals")) await postJson(chris, `/console/items/${item.reference}/approve`);
  await signIn("Mike");
  const liam = await team.as("Liam");
  const first = await raiseBug(liam, "rake-agent", "RAKE Agent shows two scroll bars on the answer");
  const second = await raiseBug(liam, "rake-agent", "RAKE Agent cuts off long policy names");

  await page.goto("/console");
  const approvals = page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: /^Approvals/ });
  await openBell(page);
  await expect(row(page, /^2 items waiting for your approval/)).toHaveCount(1);
  await expect(approvals).toHaveAccessibleName(/^Approvals ?, 2 waiting$/);

  await postJson(chris, `/console/items/${first}/approve`);
  await page.reload();
  await openBell(page);
  await expect(row(page, /^1 item waiting for your approval/)).toHaveCount(1);
  await expect(row(page, /items? waiting for your approval/)).toHaveCount(1);

  await postJson(chris, `/console/items/${second}/decline`, { reason: "Covered by another fix" });
  await page.reload();
  await openBell(page);
  await expect(row(page, /items? waiting for your approval/)).toHaveCount(0);
  await expect(approvals).toHaveAccessibleName("Approvals");
});

test("S10.13 One bell row per item: the latest step on top, the steps so far under it, read together", async ({ page, signIn, team }) => {
  // Marc owns Training Portal and is an Admin: a P1 there is assigned to him and needs approval.
  await signIn("Marc");
  await clearBell(page);
  const title = "Training Portal blocks me from opening my course";
  const ref = await raise(await team.as("Liam"), title, ["Blocking my work", "I expected the course to open but got an error"], "training-portal");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);

  await page.goto("/console");
  await openBell(page);
  const rows = page.getByRole("link", { name: new RegExp(ref) });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(`Approved, ready to start: ${ref}`);
  await expect(rows).toContainText("Steps so far: Assigned, then Needs approval, then Approved");
  await expect(rows).toHaveAccessibleName(/Unread/);

  await rows.click();
  await expect(page).toHaveURL(new RegExp(`item=${ref}`));
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  await page.keyboard.press("Escape"); // the panel covers the header while it is open
  await openBell(page);
  await expect(page.getByRole("link", { name: new RegExp(ref) })).not.toHaveAccessibleName(/Unread/);
});

test("S10.14 A notification opens where the news is: the reply in the panel, the tracker at the newest entry", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const liam = await team.as("Liam");
  const ref = await raiseBug(liam, "rake-agent", "RAKE Agent crashes when I open the leave policy");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  await postJson(page, `/console/items/${ref}/start`);
  const reply = "Tested again this morning, it still crashes on the second page.";
  await postJson(liam, `/feedback/${ref}/replies`, { body: reply });

  await page.goto("/console");
  await openBell(page);
  await row(page, new RegExp(`${ref}: Liam Carter replied`)).click();
  await expect(page).toHaveURL(new RegExp(`item=${ref}&msg=`));
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");
  const message = panel.locator("li[id^='msg-']").filter({ hasText: reply });
  // The ring fades after 2.5 s (D81), so it is checked before the wait for the scroll to settle.
  await expect(message).toHaveClass(/ring-2/);
  await expect(message).toBeInViewport();

  await postJson(page, `/console/items/${ref}/update`, { body: "Found it: the second page loads the wrong policy." });
  await liam.goto("/my");
  await openBell(liam);
  await row(liam, new RegExp(`Update on ${ref}`)).click();
  await expect(liam).toHaveURL(new RegExp(`/track/${ref}#latest$`));
  await expect(liam.locator("section#activity li#latest")).toBeInViewport();
});

test("S10.15 A fixed P1 is told to every Admin and the triage lead; a P2 is not", async ({ page, signIn, team }) => {
  await signIn("Chris");
  const liam = await team.as("Liam");
  const darlene = await team.as("Darlene");
  const marc = await team.as("Marc");
  const p1 = await raise(liam, "RAKE Agent gives a blank answer when I ask about my roster.", ["It's blocking my work", "I expected an answer about my roster, but got an empty box"], "rake-agent");
  const p2 = await raiseBug(liam, "rake-agent", "RAKE Agent is slow to answer about my roster");
  for (const ref of [p1, p2]) {
    await postJson(marc, `/console/items/${ref}/approve`);
    await postJson(darlene, `/console/items/${ref}/start`);
    await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Fixed: answers about rosters work again." });
    // Liam confirms each fix (D92).
    await postJson(liam, `/feedback/${ref}/fixed`);
  }

  await page.goto("/console");
  await openBell(page);
  const fixed = page.getByRole("link", { name: new RegExp(`Fixed: ${p1}`) });
  await expect(fixed).toBeVisible();
  await expect(fixed).toContainText(/Steps so far: .*then Resolved, then Fixed/);
  await expect(page.getByRole("link", { name: new RegExp(p2) })).toHaveCount(0);
});
