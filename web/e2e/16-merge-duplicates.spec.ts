import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, postJson, raise, raiseBug, statusButton } from "./helpers";

// Manual checklist section 16 (Digital Staff: merge and duplicates): merging through the item panel,
// what the merged item's submitter and the original then show, and that nothing merges on its own.
// Each test uses its own tool, so the duplicates one test makes are never candidates in another.

test.beforeAll(resetDatabase);

// The stub finds duplicates by comparing words (same tool, open item, at least half the same words),
// so the two descriptions differ only in words the comparison ignores ("the", "really", "on").
const PROJECT = "rake-agent";
const FIRST = "The RAKE Agent is slow on big PDFs";
const SECOND = "RAKE agent is really slow on big PDFs";

type Card = { reference: string };
type Item = { reference: string; status: string; close_reason: string | null; merged_into: string | null; linked: string[] };

/** Mike describes the same problem in a new chat, ignores the duplicate box and confirms; returns the new reference. */
async function raiseSeparately(mike: Page, text: string) {
  await mike.goto("/chat");
  await expect(mike.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await chatSay(mike, text);
  await expect(mike.getByText("Someone may have raised this already", { exact: true })).toBeVisible();
  await mike.getByRole("button", { name: "Confirm" }).click();
  const heading = mike.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).match(/FB-\d{4}/)![0];
}

/** Near-identical pairs on tools nobody else in this file uses (the same pairs as e2e/05-duplicates.spec.ts). */
const PAIRS = {
  flipbook: { project: "flipbook", first: "The Flipbook is slow to open big brochures", second: "Flipbook is really slow to open big brochures" },
  training: { project: "training-portal", first: "The Training Portal is slow to load big courses", second: "Training Portal is really slow to load big courses" },
  afss: { project: "afss-portal", first: "The AFSS Portal is slow to save big statements", second: "AFSS Portal is really slow to save big statements" },
  cpd: { project: "cpd-tracker", first: "The CPD Tracker is slow to load big histories", second: "CPD Tracker is really slow to load big histories" },
};

/** Liam raises the original and Aisha the same problem again, so merging gives Aisha something to follow. */
async function pair(team: { as: (first: string) => Promise<Page> }, { project, first, second }: (typeof PAIRS)[keyof typeof PAIRS]) {
  const original = await raise(await team.as("Liam"), first, ["Slowing me down"], project);
  const separate = await raise(await team.as("Aisha"), second, ["Slowing me down"], project);
  return { original, separate };
}

/** The console item panel for an item, opened by address (Darlene's board has no Awaiting approval column). */
async function openPanel(page: Page, ref: string) {
  await page.goto(`/console?inbox=open&item=${ref}`);
  const panel = page.getByRole("dialog").filter({ hasText: ref });
  await expect(panel).toBeVisible();
  return panel;
}

/** The merge is saved once the original lists it; wait for that before another window reads it. */
async function merged(page: Page, separate: string, into: string) {
  await expect.poll(async () => (await getJson<Item>(page, `/console/items/${into}`)).linked).toContain(separate);
}

/** What Aisha, who raised the merged item, sees: its tracker points at the original by a link, and she follows the original. */
async function expectFollowsOriginal(aisha: Page, separate: string, original: string) {
  await aisha.goto(`/track/${separate}`);
  await expect(aisha.getByRole("heading", { level: 1 })).toHaveText(`Duplicate of ${original}`);
  const progress = aisha.getByRole("region", { name: "Progress" });
  await expect(progress.getByRole("listitem").filter({ hasText: "Duplicate" })).not.toContainText("not yet");
  const link = progress.getByRole("link", { name: original, exact: true });
  await expect(link).toHaveAttribute("href", `/track/${original}`);
  await link.click();
  await expect(aisha).toHaveURL(new RegExp(`/track/${original}$`));
  await expect(aisha.getByRole("heading", { level: 1 })).toBeVisible();

  await aisha.goto("/my");
  await expect(aisha.getByRole("link", { name: new RegExp(`${original}(?!\\d)`) })).toContainText("Following");
}

test("S16.01 'Merge' closes the newer item, its tracker says 'Duplicate of FB-…' with a link, and its submitter follows the original", async ({ team }) => {
  const { original, separate } = await pair(team, PAIRS.flipbook);
  const darlene = await team.as("Darlene");

  const panel = await openPanel(darlene, separate);
  const duplicates = panel.getByRole("region", { name: "Duplicates" });
  await expect(duplicates).toContainText(original);
  await duplicates.getByRole("button", { name: "Merge", exact: true }).click();

  // The suggested merge goes through the same dialog as a typed one, pre-filled, and nothing happens until it is confirmed.
  const dialog = darlene.getByRole("dialog", { name: "Merge duplicates", exact: true });
  await expect(dialog.getByLabel("Original reference")).toHaveValue(original);
  expect((await getJson<Item>(darlene, `/console/items/${separate}`)).merged_into, "nothing is merged before the dialog is confirmed").toBeNull();
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(duplicates).toContainText(`Merged into ${original}.`);
  // Closed: nothing can be merged or closed from it any more.
  await expect(duplicates.getByRole("button", { name: "Merge", exact: true })).toHaveCount(0);
  await expect(statusButton(panel)).toHaveCount(0);

  await merged(darlene, separate, original);
  await expectFollowsOriginal(await team.as("Aisha"), separate, original);
});

test("S16.02 'Merge with another reference…' with a typed FB number gives the same result", async ({ team }) => {
  const { project, first, second } = PAIRS.training;
  const candidate = await raise(await team.as("Liam"), first, ["Slowing me down"], project);
  // The one typed in is not the listed candidate, so the result can only come from what was typed.
  const typed = await raiseBug(await team.as("Tom"), project, "Training Portal certificate download shows an error");
  const separate = await raise(await team.as("Aisha"), second, ["Slowing me down"], project);
  const darlene = await team.as("Darlene");

  const panel = await openPanel(darlene, separate);
  const duplicates = panel.getByRole("region", { name: "Duplicates" });
  await expect(duplicates).toContainText(candidate);
  await expect(duplicates).not.toContainText(typed);
  await duplicates.getByRole("button", { name: /^Merge with another reference/ }).click();

  const dialog = darlene.getByRole("dialog", { name: "Merge duplicates", exact: true });
  await dialog.getByLabel("Original reference").fill(typed.toLowerCase());
  await expect(dialog.getByLabel("Original reference")).toHaveValue(typed);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(duplicates).toContainText(`Merged into ${typed}.`);

  await merged(darlene, separate, typed);
  await expectFollowsOriginal(await team.as("Aisha"), separate, typed);
});

test("S16.03 The original shows 'Merged here: FB-…'", async ({ team }) => {
  const { original, separate } = await pair(team, PAIRS.afss);
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${separate}/merge`, { into: original });
  await merged(darlene, separate, original);

  const duplicates = (await openPanel(darlene, original)).getByRole("region", { name: "Duplicates" });
  await expect(duplicates).toContainText(`Merged here: ${separate}`);
  // Merged, it is no longer offered as a duplicate.
  await expect(duplicates.getByRole("button", { name: "Merge", exact: true })).toHaveCount(0);
});

test("S16.04 Two near-identical items sit side by side offering 'Merge', and none of the items is merged until someone clicks", async ({
  page,
  signIn,
  team,
}) => {
  await signIn("Mario");
  const original = await raise(page, FIRST, ["Slowing me down"], PROJECT);
  const separate = await raiseSeparately(await team.as("Mike"), SECOND);
  expect(separate).not.toBe(original);

  // The duplicate is only offered: the button is there, and the panel says nothing was merged.
  const darlene = await team.as("Darlene");
  await darlene.goto(`/console?inbox=open&item=${separate}`);
  const panel = darlene.getByRole("dialog");
  const duplicates = panel.getByRole("region", { name: "Duplicates" });
  await expect(duplicates).toContainText(original);
  await expect(duplicates.getByRole("button", { name: "Merge", exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Merged into");
  await darlene.goto(`/console?inbox=open&item=${original}`);
  await expect(duplicates).toContainText(separate);
  await expect(panel).not.toContainText("Merged here");

  // Every RAKE Agent item (the tests above merge on other tools on purpose): none is linked, none closed as a merge.
  const chris = await team.as("Chris");
  const cards = (await getJson<{ items: Card[] }>(chris, `/console/items?inbox=all&project=${PROJECT}`)).items;
  expect(cards.map((c) => c.reference)).toEqual(expect.arrayContaining([original, separate]));
  for (const card of cards) {
    const item = await getJson<Item>(chris, `/console/items/${card.reference}`);
    expect(item.merged_into, `${card.reference} merged_into`).toBeNull();
    expect(item.linked, `${card.reference} linked`).toHaveLength(0);
    expect(item.close_reason ?? "", `${card.reference} close_reason`).not.toContain("Merged");
    expect(item.status, `${card.reference} status`).not.toBe("declined");
  }
});

test("S16.05 Someone else opening the merged item sees 'View original ticket', which opens the original as general information", async ({ team }) => {
  const { original, separate } = await pair(team, PAIRS.cpd);
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${separate}/merge`, { into: original });
  await merged(darlene, separate, original);

  const tom = await team.as("Tom");
  await tom.goto(`/track/${separate}`);
  await expect(tom.getByRole("heading", { level: 1 })).toHaveText(`Duplicate of ${original}`);
  await tom.getByRole("link", { name: "View original ticket" }).click();
  await expect(tom).toHaveURL(new RegExp(`/track/${original}$`));
  await expect(tom.getByText("Someone else's feedback")).toBeVisible();
});
