import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, postJson, raiseBug } from "./helpers";

// Manual checklist section 17 (Digital Staff: project channels). Darlene, a Digital Staff member, uses the
// channels on screen; the items the channels point at are raised by Liam and approved by Chris through the API.

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };
type ProjectRow = { slug: string; name: string; project_group: "platforms" | "agents" | "other" };
type ReleaseRow = { id: string; project: { slug: string }; status: string };
type ReleaseDetail = ReleaseRow & {
  items: { id: string; title: string; body: string; work_type: string | null; source_type: string; visible_to_staff: boolean }[];
};

const RAKE = "/console/channels/rake-agent";

const messageBox = (page: Page) => page.getByLabel("Message", { exact: true });
/** A message in the channel's main list (pinned messages sit in their own region above it). */
const listed = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: text });
const pinnedRegion = (page: Page) => page.getByRole("region", { name: "Pinned" });

/** Post on the channel screen the way a person does: type, press Enter, wait for it to show. */
async function postOnScreen(page: Page, text: string) {
  await messageBox(page).fill(text);
  await messageBox(page).press("Enter");
  await expect(messageBox(page)).toHaveValue("");
}

/** Raise a RAKE Agent bug as Liam (Darlene's tool, so Darlene holds it). */
async function raiseForRake(team: Team, title: string) {
  return raiseBug(await team.as("Liam"), "rake-agent", title);
}

test("S17.01 Channels lists one channel per project, grouped, with 'Staff never see these'", async ({ page, signIn }) => {
  await signIn("Darlene");
  const projects = await (await page.request.get("/api/projects")).json() as ProjectRow[];
  await page.goto("/console/channels");

  await expect(page.getByRole("heading", { level: 1, name: "Channels" })).toBeVisible();
  await expect(page.getByText("Private to the Digital team. Staff never see these.")).toBeVisible();

  // One link per project, under its group, in the order Platforms, Agents, Other.
  const groups = [
    ["platforms", "Platforms"],
    ["agents", "Agents"],
    ["other", "Other"],
  ] as const;
  let previousTop = -1;
  for (const [key, title] of groups) {
    const expected = projects.filter((p) => p.project_group === key);
    expect(expected.length, `projects in ${key}`).toBeGreaterThan(0);
    const section = page.getByRole("region", { name: title, exact: true });
    await expect(section.getByRole("link")).toHaveCount(expected.length);
    for (const p of expected) await expect(section.getByRole("link", { name: p.name, exact: true })).toHaveAttribute("href", `/console/channels/${p.slug}`);
    const top = (await section.boundingBox())!.y;
    expect(top).toBeGreaterThan(previousTop);
    previousTop = top;
  }
  await expect(page.getByRole("region", { name: "Agents", exact: true }).getByRole("link", { name: "RAKE Agent", exact: true })).toBeVisible();
});

test("S17.02 Posting in the RAKE Agent channel shows the message with your name and time; Enter posts", async ({ page, signIn }) => {
  const who = await signIn("Darlene");
  const text = "Weekly check: the RAKE Agent knowledge base was refreshed this morning";
  await page.goto("/console/channels");
  await page.getByRole("region", { name: "Agents", exact: true }).getByRole("link", { name: "RAKE Agent", exact: true }).click();
  await expect(page).toHaveURL(/\/console\/channels\/rake-agent$/);
  await expect(page.getByRole("heading", { level: 1, name: "# RAKE Agent" })).toBeVisible();

  await postOnScreen(page, text);
  const posted = listed(page, text);
  await expect(posted).toHaveCount(1);
  await expect(posted).toContainText(who.name);
  await expect(posted).toContainText(/\d{1,2}:\d{2}\s?[ap]m/i);

  // It was saved, not just drawn: it is still there after a reload.
  await page.reload();
  await expect(listed(page, text)).toHaveCount(1);
});

test("S17.03 A #FB reference becomes a chip with the item's live stage, and clicking it opens the item", async ({ page, signIn, team }) => {
  test.setTimeout(120_000);
  const title = "RAKE Agent shows an error when I open the channel link test";
  const ref = await raiseForRake(team, title);
  await signIn("Darlene");
  await page.goto(RAKE);
  await postOnScreen(page, `Please look at #${ref} today`);

  const chip = page.getByRole("link", { name: new RegExp(`^${ref} `) });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/Awaiting approval|Needs review/);

  // The stage is live: once an Admin approves the item, the same chip says so.
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await page.reload();
  await expect(chip).toContainText("Approved");
  await expect(chip).not.toContainText(/Awaiting approval|Needs review/);

  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/console\\?inbox=all&item=${ref}$`));
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText(ref);
  await expect(panel).toContainText(title);
});

test("S17.04 @Mario is highlighted in the message and Mario gets a notification", async ({ page, signIn, team }) => {
  const who = await signIn("Darlene");
  await page.goto(RAKE);
  await postOnScreen(page, "@Mario please check");

  const posted = listed(page, "please check");
  await expect(posted.getByText("@Mario", { exact: true })).toHaveClass(/font-semibold/);

  const mario = await team.as("Mario");
  await mario.goto("/console");
  await mario.getByRole("button", { name: /^Notifications/ }).click();
  const note = mario.getByRole("link", { name: `${who.name} mentioned you in #rake-agent` });
  await expect(note).toBeVisible();
  await expect(note).toContainText("@Mario please check");
  await expect(note).toHaveAccessibleName(/Unread/);

  await note.click();
  await expect(mario).toHaveURL(new RegExp(`${RAKE}$`));
});

test("S17.05 Pinning moves a message to Pinned at the top and unpinning moves it back", async ({ page, signIn }) => {
  await signIn("Darlene");
  const decision = "Decision: RAKE Agent answers are reviewed every Friday";
  const other = "Reminder: the RAKE Agent log export runs overnight";
  await postJson(page, "/console/channels/rake-agent", { body: decision });
  await postJson(page, "/console/channels/rake-agent", { body: other });
  await page.goto(RAKE);

  await expect(pinnedRegion(page)).toHaveCount(0);
  await expect(listed(page, decision)).toHaveCount(1);

  await listed(page, decision).getByRole("button", { name: "Pin", exact: true }).click();
  await expect(pinnedRegion(page)).toContainText(decision);
  await expect(pinnedRegion(page)).not.toContainText(other);
  await expect(listed(page, decision)).toHaveCount(0);
  const pinnedTop = (await pinnedRegion(page).boundingBox())!.y;
  const otherTop = (await listed(page, other).boundingBox())!.y;
  expect(pinnedTop).toBeLessThan(otherTop);

  await pinnedRegion(page).getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(pinnedRegion(page)).toHaveCount(0);
  await expect(listed(page, decision)).toHaveCount(1);
  await expect(listed(page, decision).getByRole("button", { name: "Pin", exact: true })).toBeVisible();
});

test("S17.06 Channel text stays out of the tracker and What's new, unless an owner ticks it in a release", async ({ page, signIn, team }) => {
  test.setTimeout(120_000);
  // Liam stands in for Mario as the person who raised the item (Mario is Digital Staff and has the console, not the staff pages).
  const note = "Channel only: vendor rollout moves to Thursday";
  const hidden = "Channel only: logins for the vendor portal are in the vault";
  const ref = await raiseForRake(team, "RAKE Agent shows an error when I resize the answer panel");
  const darlene = await team.as("Darlene");
  await postJson(darlene, "/console/channels/rake-agent", { body: `${note}, see #${ref}` });
  await postJson(darlene, "/console/channels/rake-agent", { body: hidden });

  await signIn("Liam");
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("vendor rollout");
  await page.goto("/my");
  await expect(page.getByText("RAKE Agent shows an error when I resize the answer panel").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("vendor rollout");
  await page.goto("/whats-new");
  await expect(page.getByText("Nothing published yet. Each Friday the Digital team shares what changed.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("vendor rollout");

  // The Friday draft lists the channel posts unticked; the owner ticks one and publishes.
  const chris = await team.as("Chris");
  await postJson(chris, "/console/releases/draft-now");
  const drafts = await getJson<ReleaseRow[]>(chris, "/console/releases");
  const draft = drafts.find((r) => r.project.slug === "rake-agent" && r.status === "draft")!;
  const detail = await getJson<ReleaseDetail>(chris, `/console/releases/${draft.id}`);
  const channelItems = detail.items.filter((i) => i.source_type === "channel");
  expect(channelItems.length).toBeGreaterThanOrEqual(2);
  expect(channelItems.every((i) => !i.visible_to_staff)).toBe(true);
  const ticked = detail.items.map((i) => ({ ...i, visible_to_staff: i.title.includes("vendor rollout") }));
  const saved = await chris.request.put(`/api/console/releases/${detail.id}/items`, { data: { items: ticked } });
  expect(saved.ok(), `PUT items -> ${saved.status()}`).toBeTruthy();
  await postJson(chris, `/console/releases/${detail.id}/publish`);

  await page.goto("/whats-new");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { level: 2, name: "RAKE Agent" }) });
  await expect(card).toContainText("vendor rollout moves to Thursday");
  await expect(card).not.toContainText("logins for the vendor portal");
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("vendor rollout");
});
