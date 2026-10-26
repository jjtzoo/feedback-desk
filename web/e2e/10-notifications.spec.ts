import { type Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { postJson, raiseBug } from "./helpers";

// Manual checklist section 10: the bell, what raises a notification, and muting an item.
// Liam stands in for Mario (the person who raised it); RAKE Agent is Darlene's, so she is assigned.

test.beforeAll(resetDatabase);

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const openBell = (page: Page) => bell(page).click();

/** Mark everything read through the API, so a test starts from an empty count. */
const clearBell = (page: Page) => postJson(page, "/notifications/read");

/** The bell's row for an item, found by the words in its title. */
const row = (page: Page, text: RegExp) => page.getByRole("link", { name: text });

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
  await postJson(darlene, `/console/items/${ref}/close`, { reason: "Confirmed working" });

  await page.goto("/my");
  await expect(bell(page)).toHaveAccessibleName("Notifications, 6 unread");
  await openBell(page);
  const titles = [`${ref} is planned`, `${ref} is being worked on`, `Update on ${ref}`, `replied on ${ref}`, `${ref} is resolved`, `${ref} is fixed`];
  for (const title of titles) await expect(row(page, new RegExp(title)), title).toBeVisible();
});

test("S10.07 A new item notifies the owner on assignment and again when the submitter replies", async ({ page, signIn, team }) => {
  const darlene = await team.as("Darlene");
  await clearBell(darlene);
  await signIn("Liam");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent drops my session after ten minutes");

  await page.goto(`/track/${ref}`);
  await page.getByLabel("Reply or add details").fill("It also happens on my phone");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Added. The owner has been told.")).toBeVisible();

  await darlene.goto("/console");
  await expect(bell(darlene)).toHaveAccessibleName("Notifications, 2 unread");
  await openBell(darlene);
  await expect(row(darlene, new RegExp(`New feedback assigned to you: ${ref}`))).toBeVisible();
  await expect(row(darlene, new RegExp(`${ref}: Liam Carter added details`))).toBeVisible();
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
