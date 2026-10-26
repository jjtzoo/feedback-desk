import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, raise } from "./helpers";

// Manual checklist section 5: staff duplicates ("+1 and comment").

test.beforeAll(resetDatabase);

// The stub finds duplicates by comparing words (same tool, open item, at least half the same words),
// so each pair below differs only in words the comparison ignores ("the", "really", "with" and
// "on"), and every test uses its own tool so earlier items never become extra matches.
const PAIRS = {
  rake: { project: "rake-agent", first: "The RAKE Agent is slow with big PDFs", second: "RAKE agent is really slow on big PDFs" },
  flipbook: { project: "flipbook", first: "The Flipbook is slow to open big brochures", second: "Flipbook is really slow to open big brochures" },
  training: { project: "training-portal", first: "The Training Portal is slow to load big courses", second: "Training Portal is really slow to load big courses" },
  finance: { project: "financial-platform", first: "The Financial Platform is slow to export big reports", second: "Financial Platform is really slow to export big reports" },
  afss: { project: "afss-portal", first: "The AFSS Portal is slow to save big statements", second: "AFSS Portal is really slow to save big statements" },
  asset: { project: "it-asset", first: "The IT Asset register is slow to load big lists", second: "IT Asset register is really slow to load big lists" },
};

const SOMEONE = "Someone may have raised this already";

/** Mike describes the same problem in a new chat and answers the impact question; returns the duplicate box. */
async function describeAgain(mike: Page, text: string) {
  await mike.goto("/chat");
  await expect(mike.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await chatSay(mike, text);
  await mike.getByRole("button", { name: "Slowing me down" }).click();
  const box = mike.getByText(SOMEONE, { exact: true }).locator("xpath=ancestor::li[1]");
  await expect(box).toBeVisible();
  return box;
}

test("S05.01 A likely duplicate shows 'Someone may have raised this already' with the reference, title and 'Add my comment there instead'", async ({
  page,
  signIn,
  team,
}) => {
  const { project, first, second } = PAIRS.rake;
  await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const box = await describeAgain(await team.as("Mike"), second);
  await expect(box).toContainText(ref);
  await expect(box).toContainText(first);
  await expect(box.getByRole("button", { name: "Add my comment there instead" })).toBeVisible();
});

test("S05.02 The duplicate box shows only the reference and title, no submitter name", async ({ page, signIn, team }) => {
  const { project, first, second } = PAIRS.flipbook;
  const mario = await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const box = await describeAgain(await team.as("Mike"), second);
  await expect(box).toContainText(ref);
  await expect(box).toContainText(first);
  await expect(box).not.toContainText(mario.name.split(" ")[0]);
  await expect(box).not.toContainText(mario.email);
});

test("S05.03 'Add my comment there instead' says 'Added to FB-00nn' and makes no new reference", async ({ page, signIn, team }) => {
  const { project, first, second } = PAIRS.training;
  await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const mike = await team.as("Mike");
  const box = await describeAgain(mike, second);
  await box.getByRole("button", { name: "Add my comment there instead" }).click();
  await expect(mike.getByRole("heading", { name: `Added to ${ref}` })).toBeVisible();
  await expect(mike.getByRole("heading", { name: /Sent\. Your reference is/ })).toHaveCount(0);

  // Nothing of Mike's own was created: the only item he has is the one he now follows.
  const mine = await getJson<{ reference: string; following: boolean }[]>(mike, "/my/feedback");
  expect(mine.filter((i) => !i.following)).toHaveLength(0);
  expect(mine.map((i) => i.reference)).toContain(ref);
});

test("S05.04 My feedback lists the original item for the person who added a comment, with a 'Following' badge", async ({ page, signIn, team }) => {
  const { project, first, second } = PAIRS.finance;
  await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const mike = await team.as("Mike");
  const box = await describeAgain(mike, second);
  await box.getByRole("button", { name: "Add my comment there instead" }).click();
  await expect(mike.getByRole("heading", { name: `Added to ${ref}` })).toBeVisible();

  await mike.goto("/my");
  const row = mike.getByRole("link", { name: new RegExp(ref) });
  await expect(row).toContainText(first);
  await expect(row).toContainText("Following");
});

test("S05.05 The owner sees 'Also following: Mike', impact raised to a team, and Mario's tracker says another staff member reported the same thing", async ({
  page,
  signIn,
  team,
}) => {
  const { project, first, second } = PAIRS.afss;
  await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const darlene = await team.as("Darlene");
  await darlene.goto(`/console?inbox=open&item=${ref}`);
  const panel = darlene.getByRole("dialog");
  await expect(panel).toContainText(/Impact: one person/);
  await expect(panel).not.toContainText("Also following");

  const mike = await team.as("Mike");
  const box = await describeAgain(mike, second);
  await box.getByRole("button", { name: "Add my comment there instead" }).click();
  await expect(mike.getByRole("heading", { name: `Added to ${ref}` })).toBeVisible();

  await darlene.goto(`/console?inbox=open&item=${ref}`);
  await expect(panel).toContainText(/Also following: Mike/);
  await expect(panel).toContainText(/Impact: team/);

  await page.goto(`/track/${ref}`);
  await expect(page.getByText("Another staff member reported the same thing")).toBeVisible();
});

test("S05.06 Ignoring the box and pressing Confirm makes a separate item, shown under 'Possible duplicates' with a % similar, and nothing merges", async ({
  page,
  signIn,
  team,
}) => {
  const { project, first, second } = PAIRS.asset;
  await signIn("Mario");
  const ref = await raise(page, first, ["Slowing me down"], project);

  const mike = await team.as("Mike");
  await describeAgain(mike, second);
  await mike.getByRole("button", { name: "Confirm" }).click();
  const heading = mike.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  const separate = (await heading.innerText()).match(/FB-\d{4}/)![0];
  expect(separate).not.toBe(ref);

  const darlene = await team.as("Darlene");
  await darlene.goto(`/console?inbox=open&item=${separate}`);
  const panel = darlene.getByRole("dialog");
  const duplicates = panel.getByRole("region", { name: "Duplicates" });
  await expect(duplicates).toContainText("Possible duplicates");
  await expect(duplicates).toContainText(ref);
  await expect(duplicates).toContainText(/\d+% similar/);

  // Nothing merged by itself: neither item is closed or linked to the other.
  await expect(panel).not.toContainText("Merged into");
  const item = await getJson<{ status: string; merged_into: string | null }>(darlene, `/console/items/${separate}`);
  expect(item.status).not.toBe("closed");
  expect(item.merged_into).toBeNull();
  const original = await getJson<{ status: string; linked: string[] }>(darlene, `/console/items/${ref}`);
  expect(original.status).not.toBe("closed");
  expect(original.linked).toHaveLength(0);
});
