import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { messageBox, openActivity, openTab, raiseBug, trackerConversation } from "./helpers";

// Manual checklist section 26: passwords, card numbers and TFNs are masked before anything is stored.
// People raise through the API (the backend does the masking) and the results are read on screen: the
// console's Brief (with the intake transcript) and With <name> tabs, and the staff tracker.

test.beforeAll(resetDatabase);

// A valid card number (Luhn) and a valid TFN (checksum), as the masking only removes real-looking ones.
const SECRETS = "My password is Hunter2, card 4111 1111 1111 1111, TFN 123 456 782";
const DESCRIPTION = `The Flipbook login is broken. ${SECRETS}`;
const RAW = ["Hunter2", "4111 1111 1111 1111", "123 456 782"];
const MARKERS = ["[password removed]", "[card number removed]", "[TFN removed]"];

/** Every marker shows and no raw secret does. The markers are asserted first, so an empty area cannot pass. */
async function expectMasked(area: Locator) {
  for (const marker of MARKERS) await expect(area).toContainText(marker);
  for (const raw of RAW) await expect(area).not.toContainText(raw);
}

/** The server-sent events a chat call returns, as name and data. */
function sse(body: string) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .map((block) => {
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      return data ? { name, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((e): e is { name: string; data: Record<string, unknown> } => e !== null);
}

/**
 * Raise a Flipbook bug (Marc's) in a chat and confirm it. The stub builds the brief from the first sentence
 * only, so `followUp` is sent while the card shows: the stub appends it to the brief's Problem, which is
 * where the console's Brief tab can show what the masking left of it.
 */
async function raiseInChat(page: Page, description: string, followUp?: string) {
  const api = page.request;
  const start = await (await api.post("/api/chat/sessions", { data: { project_slug: "flipbook", context: {} } })).json();
  const url = `/api/chat/sessions/${start.session_id}`;
  const say = async (text: string) => sse(await (await api.post(`${url}/messages`, { data: { text, attachment_ids: [] } })).text());
  let events = await say(description);
  for (const answer of ["Slowing me down", "I expected to log in but got an error"]) {
    if (events.some((e) => e.name === "draft")) break;
    events = await say(answer);
  }
  if (followUp) events = await say(followUp);
  const draft = events.find((e) => e.name === "draft");
  if (!draft) throw new Error(`No confirm card for: ${description}`);
  const done = sse(await (await api.post(`${url}/confirm`, { data: { draft_hash: draft.data.hash } })).text()).find((e) => e.name === "done");
  if (!done) throw new Error(`Not saved: ${description}`);
  return done.data.reference as string;
}

/** The console's item panel, opened by its address as a pasted link would, once it has loaded. */
async function openPanel(page: Page, ref: string) {
  await page.goto(`/console?inbox=open&item=${ref}`);
  const panel = page.getByRole("dialog");
  await expect(panel.getByText(ref, { exact: true })).toBeVisible();
  return panel;
}

/** The intake transcript, unfolded at the foot of Brief. */
async function transcript(panel: Locator) {
  await openTab(panel, "Brief");
  const region = panel.getByRole("region", { name: "Intake transcript" });
  await region.locator("summary").click();
  return region;
}

/** The Conversation tab's lines (D105). */
async function conversation(panel: Locator) {
  await openActivity(panel);
  return panel.getByRole("tabpanel");
}

/** Reply on the tracker as the signed-in submitter, then reload so what shows is what was stored. */
async function replyOnTracker(page: Page, ref: string, text: string) {
  await page.goto(`/track/${ref}`);
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return trackerConversation(page);
}

test("S26.01 A chat with a password, card number and TFN shows [password removed], [card number removed] and [TFN removed] in the console transcript and brief", async ({ page, signIn, team }) => {
  await signIn("Marc");
  const ref = await raiseInChat(await team.as("Mei"), DESCRIPTION, `Here are the details again. ${SECRETS}`);
  const panel = await openPanel(page, ref);

  // The brief opens first: its Problem holds the sentence sent while the card showed.
  const problem = panel.locator('dt:text-is("Problem") + dd');
  await expect(problem).toContainText("The Flipbook login is broken.");
  await expectMasked(problem);
  await expectMasked(panel.getByRole("tabpanel"));

  const lines = await transcript(panel);
  const first = lines.getByRole("listitem").filter({ hasText: "The Flipbook login is broken." }).first();
  await expect(first).toContainText("Mei Lin");
  await expectMasked(first);
  await expectMasked(lines);
});

test("S26.02 The same text in a tracker message is masked in the console's Conversation tab and on the tracker after reload", async ({ page, signIn, team }) => {
  await signIn("Grace");
  const ref = await raiseBug(page, "flipbook", "The Flipbook login page shows an error when I sign in");
  const history = await replyOnTracker(page, ref, DESCRIPTION);

  const entry = history.getByRole("listitem").filter({ hasText: "The Flipbook login is broken." });
  await expect(entry).toContainText("You");
  await expectMasked(entry);
  await expectMasked(history);

  const panel = await openPanel(await team.as("Marc"), ref);
  const lines = await conversation(panel);
  const reply = lines.getByRole("listitem").filter({ hasText: "The Flipbook login is broken." });
  await expect(reply).toContainText("Grace O'Brien");
  await expect(reply).toContainText("The Flipbook login is broken.");
  await expectMasked(reply);
  await expectMasked(lines);
});

test("S26.03 An ordinary number such as invoice 20231015 is kept as typed", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const message = "The Flipbook invoice list is broken for invoice 20231015";
  const ref = await raiseInChat(page, message);

  // The number survives in what the submitter sent (the title is the first sentence), and nothing was masked.
  await page.goto(`/track/${ref}`);
  const sent = page.getByRole("region", { name: "What you sent" });
  await expect(sent).toContainText("invoice 20231015");
  await expect(sent).not.toContainText("removed]");

  // ... in the console transcript ...
  const panel = await openPanel(await team.as("Marc"), ref);
  const lines = await transcript(panel);
  const typed = lines.getByRole("listitem").filter({ hasText: message });
  await expect(typed).toBeVisible();
  await expect(lines).not.toContainText("removed]");

  // ... and in a reply on the tracker, after reload.
  const history = await replyOnTracker(page, ref, "It is the same for invoice 20231015 and 20231016");
  const entry = history.getByRole("listitem").filter({ hasText: "It is the same for invoice 20231015 and 20231016" });
  await expect(entry).toContainText("You");
  await expect(entry).not.toContainText("removed]");
});
