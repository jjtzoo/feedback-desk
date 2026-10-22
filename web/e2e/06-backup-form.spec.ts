import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, postJson, reachBackupForm } from "./helpers";

// Manual checklist section 6: the backup form.

test.beforeAll(resetDatabase);

const DETAILS = /What happened, or what would you like/;
const GAP = "Sent through the backup form, so the agent didn't classify it.";

/**
 * The form the way the checklist reaches it with MODEL_PROVIDER=none: the chat start answers
 * "fallback". The real answer is fetched and only its mode changed, so the project list is real.
 * The API cannot be restarted without a model here, so S06.01 and S06.07 stay Stage 3.
 */
async function openOfflineForm(page: Page) {
  await page.route("**/api/chat/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const real = await (await route.fetch()).json();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...real, mode: "fallback", session_id: null, greeting: null }),
    });
  });
  await page.goto("/chat");
  await expect(page.getByLabel(DETAILS)).toBeVisible();
}

test("S06.01 With no model the chat is replaced by a form, 'Sig isn't available right now.' and 'Not available right now'", async () => {
  test.skip(true, "Stage 3: needs the API restarted without a model");
});

test("S06.02 Send feedback with empty details shows the error and focuses the field", async ({ page, signIn }) => {
  await signIn("Tom");
  const before = (await getJson<unknown[]>(page, "/my/feedback")).length;
  await openOfflineForm(page);

  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Tell us what happened or what you need.")).toBeVisible();
  await expect(page.getByLabel(DETAILS)).toBeFocused();
  // Nothing was sent.
  expect(await getJson<unknown[]>(page, "/my/feedback")).toHaveLength(before);
});

test("S06.03 The impact choices are Blocking my work, Slowing me down and Nice-to-have", async ({ page, signIn }) => {
  await signIn("Tom");
  await openOfflineForm(page);

  const choices = page.getByRole("group", { name: "How much is it affecting your work?" });
  await expect(choices.getByRole("radio")).toHaveCount(3);
  for (const label of ["Blocking my work", "Slowing me down", "Nice-to-have"]) {
    await expect(choices.getByText(label, { exact: true })).toBeVisible();
  }
});

test("S06.04 Pick a tool, write details, choose Blocking my work, send: a reference and who it went to", async ({ page, signIn }) => {
  await signIn("Tom");
  await openOfflineForm(page);

  await page.getByRole("combobox", { name: "Which tool is it about?" }).click();
  await page.getByRole("option", { name: "RAKE Agent" }).click();
  await page.getByLabel(DETAILS).fill("The roster page will not load and I cannot book shifts");
  await page.getByText("Blocking my work", { exact: true }).click();
  await page.getByRole("button", { name: "Send feedback" }).click();

  const heading = page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  // With no agent to classify it, no owner is picked: the Digital team sees it first.
  await expect(page.getByText("It's with the Digital team.")).toBeVisible();
  const ref = (await heading.innerText()).match(/FB-\d{4}/)![0];
  const mine = await getJson<{ reference: string; project: string | null }[]>(page, "/my/feedback");
  expect(mine.map((i) => i.reference)).toContain(ref);
});

test("S06.05 In the console as Marc it is in Needs review, marked backup form, P1, with the open gap", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const saved = await postJson<{ reference: string }>(page, "/feedback/fallback", {
    project_slug: "rake-agent",
    details: "The roster page will not load and I cannot book shifts",
    how_much: "blocking",
    session_id: null,
    context: {},
  });
  const ref = saved.reference;

  const marc = await team.as("Marc");
  await marc.goto(`/console?inbox=needs_review&item=${ref}`);
  const panel = marc.getByRole("dialog");
  await expect(panel).toContainText(ref);
  await expect(panel).toContainText("Needs review");
  await expect(panel).toContainText(/backup form/i);
  await expect(panel).toContainText("P1");
  await expect(panel).toContainText(GAP);
  const needsReview = await getJson<{ items: { reference: string }[] }>(marc, "/console/items?inbox=needs_review");
  expect(needsReview.items.map((i) => i.reference)).toContain(ref);
});

test("S06.06 After 13 messages the form shows with what you typed already in the details box", async ({ page, signIn }) => {
  await signIn("Tom");
  await reachBackupForm(page);

  await expect(page.getByText("Sorry, this is taking longer than it should.")).toBeVisible();
  await expect(page.getByText(/What you typed is kept below\./)).toBeVisible();
  const details = page.getByLabel(DETAILS);
  await expect(details).toHaveValue(/typed note number 1\b/);
  await expect(details).toHaveValue(/typed note number 13\b/);
  await expect(page.getByText("Not available right now")).toBeVisible();
});

test("S06.07 With the model back, the chat is back", async () => {
  test.skip(true, "Stage 3: needs the API restarted without a model");
});
