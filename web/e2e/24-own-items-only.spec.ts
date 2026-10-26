import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, person, postJson, raise, raiseBug } from "./helpers";

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

test("S24.02 staff opening one of Mario's items get the same 'We can't find that feedback' as an unknown number", async ({ page, signIn, team }) => {
  const marios = await raiseBug(await team.as("Mario"), "rake-agent", "RAKE Agent shows an error that only Mario raised");

  // Mario himself can open it, so the page below is refused by who is asking and not by a missing item.
  const mario = await team.as("Mario");
  await mario.goto(`/track/${marios}`);
  await expect(mario.getByRole("heading", { level: 1 })).toHaveText("Under review");

  await signIn("Rafael");
  const heading = page.getByRole("heading", { name: "We can't find that feedback" });

  await page.goto("/track/FB-9999");
  await expect(heading).toBeVisible();
  const unknownText = (await heading.locator("..").textContent()) ?? "";
  expect(unknownText).toContain("Check the reference");

  await page.goto(`/track/${marios}`);
  await expect(heading).toBeVisible();
  await expect(heading.locator("..")).toHaveText(unknownText);
  await expect(page.getByRole("link", { name: "Go to My feedback" })).toBeVisible();
  await expect(page.getByText("only Mario raised")).toHaveCount(0);

  // The call behind the page answers both the same way.
  const unknown = await page.request.get("/api/feedback/FB-9999/tracker");
  const refused = await page.request.get(`/api/feedback/${marios}/tracker`);
  expect(unknown.status()).toBe(404);
  expect(refused.status()).toBe(404);
  expect(await refused.json()).toEqual(await unknown.json());
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
  await page.getByRole("button", { name: "Slowing me down", exact: true }).click();
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
  await postJson(chris, `/console/items/${fixed}/resolve`, { body: "Done in this week's update" });
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
