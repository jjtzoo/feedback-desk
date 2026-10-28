import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, holderOf, person, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 24: staff see only their own items, in My feedback, on the tracker,
// the duplicate box and What's new.

test.beforeAll(resetDatabase);

type ReleaseRow = { id: string; project: { slug: string }; status: string };

const STAFF_NAMES = /\b(Liam|Aisha|Tom|Grace|Rafael|Mei|Darlene|Mario|Marc|Chris|Mike)\b/;

/** The server-sent events a chat message returns, as name and data. */
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

/** Describe a problem in a new chat as this person and answer the impact question; returns the duplicates the chat offered. */
async function offeredDuplicates(page: Page, project: string, text: string) {
  const start = await (await page.request.post("/api/chat/sessions", { data: { project_slug: project, context: {} } })).json();
  const say = async (message: string) =>
    sse(await (await page.request.post(`/api/chat/sessions/${start.session_id}/messages`, { data: { text: message, attachment_ids: [] } })).text());
  const events = [...(await say(text)), ...(await say("Slowing me down"))];
  return events.find((e) => e.name === "duplicates")?.data.candidates as Record<string, unknown>[] | undefined;
}

test("S24.01 a staff member who submits an item sees only their own items in My feedback", async ({ page, signIn, team }) => {
  // Two other people already have items that must stay out of Tom's list.
  const aisha = await raiseBug(await team.as("Aisha"), "rake-agent", "RAKE Agent shows an error on Aisha's dashboard");
  const grace = await raiseBug(await team.as("Grace"), "rake-agent", "RAKE Agent shows an error on Grace's export");

  await signIn("Tom");
  const mine = await raiseBug(page, "rake-agent", "RAKE Agent shows an error on Tom's timesheet");

  await page.goto("/my");
  await expect(page.getByRole("heading", { level: 1, name: "My feedback" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(mine) })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Open · 1$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /FB-\d{4}/ })).toHaveCount(1);
  for (const other of [aisha, grace]) await expect(page.getByText(other)).toHaveCount(0);
  await expect(page.getByText(/Aisha's dashboard|Grace's export/)).toHaveCount(0);

  const list = await getJson<{ reference: string }[]>(page, "/my/feedback");
  expect(list.map((i) => i.reference)).toEqual([mine]);
});

test("S24.02 staff opening one of Mario's items get general information, never his tracker; an unknown number is still not found", async ({ page, signIn, team }) => {
  const marios = await raiseBug(await team.as("Mario"), "rake-agent", "RAKE Agent shows an error that only Mario raised");

  await signIn("Rafael");
  await page.goto("/track/FB-9999");
  await expect(page.getByRole("heading", { name: "We can't find that feedback" })).toBeVisible();

  await page.goto(`/track/${marios}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Under review");
  await expect(page.getByText("Someone else's feedback")).toBeVisible();

  // The API decides what each viewer gets (D97): the tracker is refused like an unknown number, and
  // general information comes with only its own fields.
  const unknown = await page.request.get("/api/feedback/FB-9999/tracker");
  const refused = await page.request.get(`/api/feedback/${marios}/tracker`);
  expect(refused.status()).toBe(404);
  expect(await refused.json()).toEqual(await unknown.json());
  expect((await page.request.get("/api/feedback/FB-9999/general")).status()).toBe(404);
  const general = await page.request.get(`/api/feedback/${marios}/general`);
  expect(Object.keys(await general.json()).sort()).toEqual(["can_plus_one", "expected_by", "following", "merged_into", "muted", "project", "reference", "stage", "stages", "status_text", "summary", "title", "updates"]);
});

test("S24.03 the duplicate box and What's new show no other submitter's name", async ({ page, signIn, team }) => {
  test.setTimeout(120_000);
  const aisha = await person(page.request, "Aisha");
  const aishaPage = await team.as("Aisha");
  const first = "The IT Asset register is slow to load big lists";
  const second = "IT Asset register is really slow to load big lists";

  // The duplicate box: Mei describes what Aisha already raised.
  const ref = await raise(aishaPage, first, ["Slowing me down"], "it-asset");
  await signIn("Mei");
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await chatSay(page, second);
  const box = page.getByText("Someone may have raised this already", { exact: true }).locator("xpath=ancestor::li[1]");
  await expect(box).toContainText(ref);
  await expect(box).toContainText(first);
  await expect(box).not.toContainText("Aisha");
  await expect(box).not.toContainText(aisha.email);

  // The chat's own answer carries no name either.
  const candidates = await offeredDuplicates(page, "it-asset", second);
  expect(candidates?.map((c) => c.reference)).toContain(ref);
  expect(JSON.stringify(candidates)).not.toMatch(/Aisha/);
  expect(JSON.stringify(candidates)).not.toContain(aisha.email);

  // What's new: Aisha's fix is released by Chris; Tom reads the page.
  const released = "RAKE Agent shows an error when I open the invoice list";
  const chris = await team.as("Chris");
  const fixed = await raiseBug(aishaPage, "rake-agent", released);
  await postJson(chris, `/console/items/${fixed}/approve`);
  await postJson(await team.as(await holderOf(chris, fixed)), `/console/items/${fixed}/resolve`, { body: "Done in this week's update" });
  await postJson(chris, "/console/releases/draft-now");
  const drafts = await getJson<ReleaseRow[]>(chris, "/console/releases");
  const draft = drafts.find((r) => r.project.slug === "rake-agent" && r.status === "draft");
  expect(draft, "a RAKE Agent draft release").toBeTruthy();
  await postJson(chris, `/console/releases/${draft!.id}/publish`);

  await signIn("Tom");
  await page.goto("/whats-new");
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole("listitem")).toContainText(released);
  await expect(cards.getByText("From your feedback")).toHaveCount(0);
  const text = await cards.innerText();
  expect(text).not.toMatch(STAFF_NAMES);
  expect(text).not.toContain(aisha.email);

  const api = JSON.stringify(await getJson(page, "/whats-new"));
  expect(api).not.toMatch(STAFF_NAMES);
  expect(api).not.toContain(aisha.email);
});
