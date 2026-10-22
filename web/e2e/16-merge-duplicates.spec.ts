import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, raise } from "./helpers";

// Manual checklist section 16 (Digital Staff: merge and duplicates). Merging through the panel is
// left for Stage 3; the one item that can be shown today is that nothing merges on its own.

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
  await expect(mike.getByText("G'day, I'm Sig.")).toBeVisible();
  await chatSay(mike, text);
  await mike.getByRole("button", { name: "Slowing me down" }).click();
  await expect(mike.getByText("Someone may have raised this already", { exact: true })).toBeVisible();
  await mike.getByRole("button", { name: "Confirm" }).click();
  const heading = mike.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).match(/FB-\d{4}/)![0];
}

test("S16.01 'Merge into it' closes the item, its tracker says 'Merged into FB-…' with a link, and its submitter follows the original", async () => {
  test.skip(true, "Stage 3: duplicate merging");
});

test("S16.02 'Merge into another reference…' with a typed FB number gives the same result", async () => {
  test.skip(true, "Stage 3: duplicate merging");
});

test("S16.03 The original shows 'Merged here: FB-…'", async () => {
  test.skip(true, "Stage 3: duplicate merging");
});

test("S16.04 Two near-identical items sit side by side offering 'Merge into it', and none of the items is merged until someone clicks", async ({
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
  await expect(duplicates.getByRole("button", { name: "Merge into it" })).toBeVisible();
  await expect(panel).not.toContainText("Merged into");
  await darlene.goto(`/console?inbox=open&item=${original}`);
  await expect(duplicates).toContainText(separate);
  await expect(panel).not.toContainText("Merged here");

  // Every item in the system: none is linked, none closed as a merge.
  const chris = await team.as("Chris");
  const cards = (await getJson<{ items: Card[] }>(chris, "/console/items?inbox=all")).items;
  expect(cards.map((c) => c.reference)).toEqual(expect.arrayContaining([original, separate]));
  for (const card of cards) {
    const item = await getJson<Item>(chris, `/console/items/${card.reference}`);
    expect(item.merged_into, `${card.reference} merged_into`).toBeNull();
    expect(item.linked, `${card.reference} linked`).toHaveLength(0);
    expect(item.close_reason ?? "", `${card.reference} close_reason`).not.toContain("Merged");
    expect(item.status, `${card.reference} status`).not.toBe("declined");
  }
});
