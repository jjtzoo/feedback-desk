import { execSync } from "node:child_process";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { getJson, openActivity, pdf, postJson, raise, raiseBug, statusMoves } from "./helpers";

// Manual checklist section 13: Digital Staff, the item panel. Submitters raise through the API and
// Darlene (who owns RAKE Agent) looks at the panel on screen; Chris approves where an item must be
// Approved to sit on the board.

test.beforeAll(resetDatabase);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** A real Word and Excel file, made by the backend's own libraries so the upload's content checks pass. */
function officeFiles() {
  const code = "import base64,io,docx,openpyxl;d=docx.Document();d.add_paragraph('Notes');a=io.BytesIO();d.save(a);w=openpyxl.Workbook();w.active['A1']='Notes';b=io.BytesIO();w.save(b);print(base64.b64encode(a.getvalue()).decode()+'|'+base64.b64encode(b.getvalue()).decode())";
  const out = execSync(`uv run python -c "${code}"`, { cwd: path.join(__dirname, "..", "..", "backend"), encoding: "utf8", timeout: 60_000 });
  const [docx, xlsx] = out.trim().split("|");
  return { docx: Buffer.from(docx, "base64"), xlsx: Buffer.from(xlsx, "base64") };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Detail = {
  reference: string;
  assignee: { name: string } | null;
  ai_confidence: Record<string, number>;
  messages: { is_internal: boolean; message_type: string }[];
  events: { actor_name: string | null; is_public: boolean; public_text: string | null }[];
};

/** The panel is the page's only dialog. */
const panelOf = (page: Page) => page.getByRole("dialog");
const classification = (page: Page) => panelOf(page).getByRole("complementary", { name: "Properties" });
/** The select under a Classification label ("Project (90%)", "Assignee", ...). */
const classField = (page: Page, label: RegExp) => classification(page).locator("label").filter({ hasText: label }).getByRole("combobox");

/** Open an item's panel by its address, as a pasted link would, and wait until it has loaded. */
async function openItem(page: Page, ref: string) {
  await page.goto(`/console?inbox=open&item=${ref}`);
  const panel = panelOf(page);
  await expect(panel.getByText(ref, { exact: true })).toBeVisible();
  return panel;
}

/** Pick an option in one of the Classification selects and wait until it shows. */
async function choose(page: Page, label: RegExp, option: string) {
  await classField(page, label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(classField(page, label)).toHaveText(option);
}

/** Open the tracker's full history if it is folded, so any entry can be read. */
async function expandHistory(page: Page) {
  const more = page.getByRole("button", { name: /See full history/ });
  if (await more.count()) await more.click();
  return page.getByRole("region", { name: "Tracking history" });
}

/** The server-sent events of a chat call. */
function sseEvents(body: string) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .map((block) => {
      let name = "message";
      let data: string | null = null;
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      return data === null ? null : { name, data: JSON.parse(data) as Record<string, unknown> };
    })
    .filter((e): e is { name: string; data: Record<string, unknown> } => e !== null);
}

/** Like helpers.raise, but the chat starts with the browser details the page would capture (Context in the brief). */
async function raiseWithContext(page: Page, message: string, answers: string[], project: string, context: Record<string, string>) {
  const api = page.request;
  const start = await (await api.post("/api/chat/sessions", { data: { project_slug: project, context } })).json();
  const url = `/api/chat/sessions/${start.session_id}`;
  const say = async (text: string) => sseEvents(await (await api.post(`${url}/messages`, { data: { text, attachment_ids: [] } })).text());
  let events = await say(message);
  for (const a of answers) {
    if (events.some((e) => e.name === "draft")) break;
    events = await say(a);
  }
  const draft = events.find((e) => e.name === "draft");
  if (!draft) throw new Error(`No confirm card for: ${message}`);
  const done = sseEvents(await (await api.post(`${url}/confirm`, { data: { draft_hash: draft.data.hash } })).text()).find((e) => e.name === "done");
  if (!done) throw new Error(`Not saved: ${message}`);
  return done.data.reference as string;
}

test("S13.01 Clicking a card opens a panel on the right without leaving the board, the address gains ?item=FB-..., and Esc closes it", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raiseBug(await team.as("Liam"), "rake-agent", "RAKE Agent loses my filters after a refresh");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  // Darlene may have picked another view in an earlier file; the board is what this item is about.
  expect((await page.request.put("/api/console/view", { data: { view: "board" } })).status()).toBe(204);

  await page.goto("/console");
  const approved = page.locator('section[aria-label^="Approved"]');
  await expect(approved).toBeVisible();
  await page.locator("button", { hasText: ref }).click();

  const panel = panelOf(page);
  await expect(panel.getByText(ref, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/console\\?.*item=${ref}`));
  // The board is still the page behind it.
  await expect(approved).toBeAttached();
  await expect(page.locator("button", { hasText: ref })).toBeAttached();
  // On the right: once it has slid in, its right edge is the window's edge and its left edge leaves part of the page showing (the panel is wide, with the properties beside the brief).
  // Wait for the panel's own 200 ms slide-in to finish (not its subtree's, which has endless skeleton pulses).
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const viewport = page.viewportSize()!;
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThan(viewport.width / 8);
  expect(box.width).toBeGreaterThan(viewport.width / 2);
  expect(Math.round(box.x + box.width)).toBe(viewport.width);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).not.toHaveURL(/item=/);
  await expect(approved).toBeVisible();
});

test("S13.02 The panel header shows the reference, badges, title, tool, submitter name and age, and 'backup form' for backup-form items", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const title = "RAKE Agent keeps asking me to sign in again";
  const ref = await raiseBug(await team.as("Aisha"), "rake-agent", title);

  const panel = await openItem(page, ref);
  const header = panel.locator("header");
  await expect(header).toContainText(ref);
  await expect(header.getByText("P2 · Major")).toBeVisible();
  await expect(header.getByText("Awaiting approval", { exact: true })).toBeVisible();
  await expect(header.getByRole("heading", { name: title })).toBeVisible();
  // "Fix · tool · submitter · age": "just now" in the first minute, then "3 m ago", "2 h ago", "1 d ago".
  await expect(header).toContainText(/Fix · RAKE Agent · Aisha Rahman · (just now|\d+ [mhd] ago)/);
  await expect(header).not.toContainText("backup form");

  // The same through the backup form.
  const saved = await postJson<{ reference: string }>(await team.as("Mei"), "/feedback/fallback", {
    project_slug: "rake-agent",
    details: "RAKE Agent export stops halfway through",
    how_much: "annoying",
  });
  await openItem(page, saved.reference);
  await expect(header.getByRole("heading", { name: /RAKE Agent export stops halfway through/ })).toBeVisible();
  await expect(header).toContainText(/RAKE Agent · Mei Lin · (just now|\d+ [mhd] ago) · backup form/);
  await expect(header.getByText("P2 · Major")).toBeVisible();
});

test("S13.03 The Brief tab shows the recommendation first, then the brief's rows, the submitter's words in quotes, Context and highlighted Open gaps", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const context = { device: "Laptop", browser: "Chrome 130", screen: "1440x900", source: "/reports/12", time: "2026-10-22T09:00:00+10:00" };
  const words = "The RAKE Agent report page shows an error when I open it";
  const ref = await raiseWithContext(
    await team.as("Tom"),
    words,
    ["Slowing me down", "I expected the report to load, but it showed a blank screen"],
    "rake-agent",
    context,
  );

  const panel = await openItem(page, ref);
  await expect(panel.getByRole("tab", { name: "Brief" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("Recommendation: Implement.")).toBeVisible();
  await expect(panel.getByText("Recommendation: Implement.").locator("xpath=..")).toContainText("Raised by staff; see the brief. Effort: small. Affects one person.");

  // The rows the agent filled in for a bug, in the brief's order. Steps to reproduce, Who needs it
  // and Done when appear when the agent captured them; the stub never does, so they are not checked here.
  await expect(panel.locator("dt")).toHaveText(["Problem", "Expected", "Actual", "Submitter's words", "Context", "Open gaps"]);
  const row = (label: string) => panel.locator(`dt:text-is("${label}") + dd`);
  await expect(row("Problem")).toContainText(words);
  await expect(row("Expected")).toContainText("the report to load");
  await expect(row("Actual")).toContainText("blank screen");
  await expect(row("Submitter's words")).toHaveText(new RegExp(`^“${words}\\.?”$`));
  await expect(row("Submitter's words")).toHaveClass(/italic/);
  // The time in the app's style, in the browser's time zone (D76), never the raw string.
  await expect(row("Context")).toHaveText(/^Laptop · Chrome 130 · 1440x900 · \/reports\/12 · [A-Z][a-z]{2},? 2[12] Oct,? \d{1,2}:00\s?[ap]m$/);
  await expect(row("Open gaps")).toContainText("Steps to reproduce");
  await expect(panel.locator('dt:text-is("Open gaps")')).toHaveClass(/text-warning/);

  // Top to bottom: recommendation, then the rows; the properties sit beside them in their own column.
  const top = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.y;
  const order = [
    await top(panel.getByText("Recommendation: implement.")),
    await top(panel.locator('dt:text-is("Problem")')),
    await top(panel.locator('dt:text-is("Submitter\'s words")')),
    await top(panel.locator('dt:text-is("Context")')),
    await top(panel.locator('dt:text-is("Open gaps")')),
  ];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  const left = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.x;
  expect(await left(classification(page))).toBeGreaterThan(await left(panel.locator('dt:text-is("Problem")')));

  // A request carries "What they're asking for".
  const request = await raise(await team.as("Grace"), "Please add an export to PDF button to the RAKE Agent results page", ["Nice-to-have"], "rake-agent");
  await openItem(page, request);
  await expect(panel.locator('dt:text-is("What they\'re asking for") + dd')).toContainText("export to PDF");
});

test("S13.04 Classification shows the agent's confidence as a % for project, work type, category and priority", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  // The tool is named in the description, so the stub is sure of the project.
  const ref = await raiseBug(await team.as("Rafael"), "rake-agent", "The RAKE Agent summary page shows an error when I open it");
  const { ai_confidence: confidence } = await getJson<Detail>(page, `/console/items/${ref}`);
  for (const key of ["project", "work_type", "category", "priority"]) expect(typeof confidence[key], `the agent gave a ${key} confidence`).toBe("number");

  await openItem(page, ref);
  const percent = (key: string) => `${Math.round(confidence[key] * 100)}%`;
  await expect(classField(page, /^Project/)).toBeVisible();
  const labels = classification(page).locator("label");
  await expect(labels.filter({ hasText: /^Project/ })).toContainText(`Project (${percent("project")})`);
  await expect(labels.filter({ hasText: /^Work type/ })).toContainText(`Work type (${percent("work_type")})`);
  await expect(labels.filter({ hasText: /^Category/ })).toContainText(`Category (${percent("category")})`);
  await expect(labels.filter({ hasText: /^Priority/ })).toContainText(`Priority (${percent("priority")})`);
});

test("S13.05 Changing project, work type, category and priority saves each, and History says each change in words, marked (internal)", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raiseBug(await team.as("Mei"), "rake-agent", "RAKE Agent export page shows an error when I click save");
  await openItem(page, ref);
  await expect(classField(page, /^Project/)).toHaveText("RAKE Agent");
  await expect(classField(page, /^Work type/)).toHaveText("Fix");
  await expect(classField(page, /^Category/)).toHaveText("Bug");
  await expect(classField(page, /^Priority/)).toHaveText("P2 · Major");

  await choose(page, /^Project/, "Training Portal");
  await choose(page, /^Work type/, "Improvement");
  await choose(page, /^Category/, "Performance");
  await choose(page, /^Priority/, "P1 · Blocking");

  // Each one was saved: they are still there after a reload.
  await page.reload();
  await expect(panelOf(page).getByText(ref, { exact: true })).toBeVisible();
  await expect(classField(page, /^Project/)).toHaveText("Training Portal");
  await expect(classField(page, /^Work type/)).toHaveText("Improvement");
  await expect(classField(page, /^Category/)).toHaveText("Performance");
  await expect(classField(page, /^Priority/)).toHaveText("P1 · Blocking");

  await openActivity(panelOf(page), "History");
  const entries = panelOf(page).getByRole("tabpanel").getByRole("listitem");
  for (const change of [
    "Changed the tool from RAKE Agent to Training Portal",
    "Changed the work type from Fix to Improvement",
    "Changed the category from Bug to Performance",
    "Changed the priority from P2 · Major to P1 · Blocking",
  ]) {
    const entry = entries.filter({ hasText: change });
    await expect(entry, change).toHaveCount(1);
    await expect(entry).toContainText("Darlene");
    await expect(entry).toContainText("(internal)");
  }
});

test("S13.06 The holder hands it over to Mario: he is notified, the tracker shows Now with Mario, and away people show (away) in the list", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const liam = await team.as("Liam");
  const chris = await team.as("Chris");
  const title = "RAKE Agent charts are cut off on the right";
  const ref = await raiseBug(liam, "rake-agent", title);

  // Mike owns no tool and has no routing rule, so marking him away disturbs nothing else; he is back at the end.
  const mike = (await getJson<{ id: string; name: string }[]>(chris, "/admin/digital-staff")).find((s) => s.name === "Mike")!;
  const setAway = async (away: boolean) => expect((await chris.request.patch(`/api/admin/digital-staff/${mike.id}`, { data: { is_away: away } })).ok()).toBeTruthy();
  await setAway(true);
  try {
    const panel = await openItem(page, ref);
    const who = panel.getByRole("region", { name: "Who has it" });
    await expect(who).toContainText("Darlene");
    await panel.getByRole("button", { name: "Hand over to…" }).click();
    const dialog = page.getByRole("dialog", { name: "Hand over" });
    await dialog.getByRole("combobox", { name: "Hand over to" }).click();
    await expect(page.getByRole("option", { name: "Mike (away)", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Mario", exact: true }).click();
    await dialog.getByRole("button", { name: "Hand over", exact: true }).click();
    await expect(who).toHaveText(/With Mario/);
  } finally {
    await setAway(false);
  }

  const mario = await team.as("Mario");
  await mario.goto("/console");
  await mario.getByRole("button", { name: /^Notifications/ }).click();
  await expect(mario.getByRole("link", { name: new RegExp(`${ref} assigned to you`) })).toBeVisible();

  await liam.goto(`/track/${ref}`);
  await expect(liam.getByRole("region", { name: "Who has it" })).toContainText("Mario");
  const history = await expandHistory(liam);
  await expect(history.getByRole("listitem").first()).toContainText("Now with Mario");
});

test("S13.07 The assignee opening an item for the first time adds 'Darlene opened your feedback' to the tracker, once only", async ({ page, signIn, team }) => {
  await signIn("Tom");
  const darlene = await team.as("Darlene");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent shows yesterday's numbers after I refresh");

  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/opened your feedback/)).toHaveCount(0);

  // Opened on screen, then again, then once more straight from the API: still one entry.
  await openItem(darlene, ref);
  await darlene.reload();
  await expect(panelOf(darlene).getByText(ref, { exact: true })).toBeVisible();
  await getJson(darlene, `/console/items/${ref}`);

  await expect(async () => {
    await page.reload();
    const history = await expandHistory(page);
    await expect(history.getByText("Darlene opened your feedback")).toHaveCount(1);
  }).toPass({ timeout: 15_000 });
});

test("S13.08 The Conversation tab shows the whole chat, staff replies and dashed internal notes labelled 'Internal note'", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const words = "RAKE Agent search box shows an error when I type";
  const ref = await raiseBug(await team.as("Aisha"), "rake-agent", words);
  await postJson(page, `/console/items/${ref}/reply`, { body: "We are looking at the search box today" });
  await postJson(page, `/console/items/${ref}/note`, { body: "Probably the same cause as last month" });
  const { messages } = await getJson<Detail>(page, `/console/items/${ref}`);

  const panel = await openItem(page, ref);
  await openActivity(panel, "Messages");
  const lines = panel.getByRole("tabpanel").getByRole("listitem");
  await expect(lines).toHaveCount(messages.length);

  // The chat as it happened: Sig's greeting, what Aisha typed, Sig's questions and her answers.
  // It sits in its own read-only container, word for word in quotes, with the speaker named plainly.
  const transcript = panel.getByRole("region", { name: "Intake transcript" });
  await expect(transcript.getByRole("listitem")).toHaveCount(messages.filter((m) => m.message_type === "chat").length);
  await expect(lines.filter({ hasText: "G'day, I'm Sig, Smoke Signal's AI assistant." })).toContainText("Assistant");
  await expect(lines.filter({ hasText: words })).toContainText("Aisha Rahman");
  await expect(lines.filter({ hasText: words })).toContainText("Staff member");
  await expect(lines.filter({ hasText: words }).locator("blockquote")).toHaveClass(/italic/);
  await expect(transcript.getByRole("textbox")).toHaveCount(0);
  await expect(lines.filter({ hasText: "How much is this affecting your work" })).toHaveCount(1);
  await expect(lines.filter({ hasText: "What did you expect to happen" })).toHaveCount(1);
  await expect(lines.filter({ hasText: "Here's what I'll send" })).toHaveCount(1);

  const reply = lines.filter({ hasText: "We are looking at the search box today" });
  await expect(reply).toContainText("Darlene");
  await expect(reply).toContainText("Reply");
  await expect(reply).not.toHaveClass(/border-dashed/);

  const note = lines.filter({ hasText: "Probably the same cause as last month" });
  await expect(note).toContainText("Darlene");
  await expect(note).toContainText("Internal note");
  await expect(note).toHaveClass(/border-dashed/);

  await expect(note.locator('svg[class*="lucide-lock"]')).toHaveCount(1);
});

test("S13.09 The Files tab previews images inline, and PDF, Word and Excel files open or download from their link", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const aisha = await team.as("Aisha");
  const ref = await raiseBug(aisha, "rake-agent", "RAKE Agent export page shows an error when I click download");
  const { docx, xlsx } = officeFiles();
  const files = [
    { name: "screenshot.png", mimeType: "image/png", buffer: PNG },
    pdf("report.pdf"),
    { name: "notes.docx", mimeType: DOCX, buffer: docx },
    { name: "sheet.xlsx", mimeType: XLSX, buffer: xlsx },
  ];
  for (const file of files) {
    const r = await aisha.request.post(`/api/feedback/${ref}/attachments`, { multipart: { file } });
    expect(r.status(), `upload ${file.name}`).toBe(201);
  }

  const panel = await openItem(page, ref);
  await panel.getByRole("tab", { name: /^Files/ }).click();
  await expect(panel.getByRole("tab", { name: "Files (4)" })).toBeVisible();

  // The image shows in the panel itself (its real width is only known once it has loaded).
  const preview = panel.getByRole("img", { name: "Attachment screenshot.png" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty("naturalWidth", 1);
  await expect(panel.getByRole("img")).toHaveCount(1);

  // The others are links that open in a new tab: the file comes back whole, shown in the browser (PDF) or saved (Word, Excel).
  const opening = [
    { file: files[1], disposition: /^inline/ },
    { file: files[2], disposition: /^attachment/ },
    { file: files[3], disposition: /^attachment/ },
  ];
  for (const { file, disposition } of opening) {
    const link = panel.getByRole("link", { name: new RegExp(file.name.replace(".", "\\.")) });
    await expect(link).toHaveAttribute("target", "_blank");
    const response = await page.request.get((await link.getAttribute("href"))!);
    expect(response.status(), file.name).toBe(200);
    expect(response.headers()["content-type"]).toContain(file.mimeType);
    expect(response.headers()["content-disposition"]).toMatch(disposition);
    expect((await response.body()).length).toBe(file.buffer.length);
  }
});

test("S13.10 The History tab lists every event in plain words with who and when, internal ones marked (internal), and no raw values", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raiseBug(await team.as("Rafael"), "rake-agent", "RAKE Agent logs me out when I switch tabs");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await postJson(page, `/console/items/${ref}/start`);
  // A correction is an internal event.
  const fix = await page.request.patch(`/api/console/items/${ref}`, { data: { priority: "P1" } });
  expect(fix.ok()).toBeTruthy();
  const { events } = await getJson<Detail>(page, `/console/items/${ref}`);
  expect(events.some((e) => !e.is_public) && events.some((e) => e.is_public)).toBe(true);

  const panel = await openItem(page, ref);
  await openActivity(panel, "History");
  const entries = panel.getByRole("tabpanel").getByRole("listitem");
  await expect(entries).toHaveCount(events.length);
  await expect(entries.filter({ hasText: "(internal)" })).toHaveCount(events.filter((e) => !e.is_public).length);

  // Who and what, public ones plain, internal ones marked.
  for (const text of ["Rafael Santos · Received via chat", "Chris · Approved", "Darlene · Darlene started work"]) {
    const entry = entries.filter({ hasText: text });
    await expect(entry, text).toHaveCount(1);
    await expect(entry).not.toContainText("(internal)");
  }
  // Routing and the move to approval are the system's, in words (D56, D57).
  await expect(entries.filter({ hasText: "System · Assigned to Darlene by routing (tool owner)" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "System · Sent for approval" })).toHaveCount(1);
  // No status keys, field names or snake_case anywhere in the list.
  await expect(panel.getByRole("tabpanel")).not.toContainText(/\b[a-z]+_[a-z]+\b|→/);
  const correction = entries.filter({ hasText: "Darlene · Changed the priority from P2 · Major to P1 · Blocking" });
  await expect(correction).toHaveCount(1);
  await expect(correction).toContainText("(internal)");

  // And when: every entry carries a time of day.
  await expect(panel.getByRole("tabpanel").locator("time[datetime]")).toHaveCount(events.length);
  for (const time of await panel.getByRole("tabpanel").locator("time").all()) await expect(time).toHaveText(/\d{1,2}:\d{2}/);
});

test("S13.11 Darlene opening an Awaiting approval item sees 'Waiting for an Admin to approve' and no Start work in its Status menu", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raiseBug(await team.as("Mei"), "rake-agent", "RAKE Agent timesheet page shows an error when I open it");

  const panel = await openItem(page, ref);
  await expect(panel.getByText("Awaiting approval", { exact: true })).toBeVisible();
  await expect(panel.getByText("Waiting for an Admin to approve. Work starts once it's approved.")).toBeVisible();
  expect(await statusMoves(page, panel)).toEqual(["Close…"]);
});

test("S13.12 Mario opening an item Darlene has sees Take over, but no Start work, Update or Resolve", async ({ page, signIn, team }) => {
  const ref = await raiseBug(await team.as("Liam"), "rake-agent", "RAKE Agent loses my filters when I go back");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await signIn("Mario");
  const panel = await openItem(page, ref);
  await expect(panel.getByRole("region", { name: "Who has it" })).toContainText("Darlene");
  await expect(panel.getByRole("button", { name: "Take over", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Hand over to…", exact: true })).toHaveCount(0);
  // The Status menu has only Close: no Start work or Resolve for someone who doesn't hold it (D53, D91).
  expect(await statusMoves(page, panel)).toEqual(["Close…"]);
  await expect(panel.getByRole("button", { name: /^Update [A-Z][a-z]+$/ })).toHaveCount(0);
});

test("S13.13 Take over names whose it is and their latest step; Darlene is told, the tracker says Now with Mario, the submitter gets no notification", async ({ page, signIn, team }) => {
  const liam = await team.as("Liam");
  const ref = await raiseBug(liam, "rake-agent", "RAKE Agent hides the save button on small screens");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  const darlene = await team.as("Darlene");
  await postJson(darlene, `/console/items/${ref}/update`, { body: "Looking at the layout" });
  await postJson(liam, "/notifications/read");

  await signIn("Mario");
  const panel = await openItem(page, ref);
  await panel.getByRole("button", { name: "Take over", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Take ${ref} over from Darlene?` });
  await expect(dialog).toContainText(/Darlene posted an update (just now|\d+ m ago)\./);
  await dialog.getByLabel("Reason (optional)").fill("I know this screen");
  await dialog.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Who has it" })).toHaveText(/With Mario/);

  await darlene.goto("/console");
  await darlene.getByRole("button", { name: /^Notifications/ }).click();
  await expect(darlene.getByRole("link", { name: new RegExp(`Mario took over ${ref}`) })).toBeVisible();

  await liam.goto(`/track/${ref}`);
  // The panel reloads for its new holder, so "Mario opened your feedback" lands just after it.
  const history = await expandHistory(liam);
  await expect(history.getByRole("listitem").filter({ hasText: "Now with Mario" })).toHaveCount(1);
  await expect(liam.getByRole("button", { name: "Notifications", exact: true })).toBeVisible(); // no unread count
});

test("S13.14 When Mario and Chris both open Take over and Mario confirms first, Chris is told 'Mario has just taken this over.' and nothing changes", async ({ page, signIn, team }) => {
  const ref = await raiseBug(await team.as("Liam"), "rake-agent", "RAKE Agent shows the wrong week on the report");
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  await signIn("Chris");
  const mario = await team.as("Mario");
  const chrisPanel = await openItem(page, ref);
  const marioPanel = await openItem(mario, ref);
  await chrisPanel.getByRole("button", { name: "Take over", exact: true }).click();
  await marioPanel.getByRole("button", { name: "Take over", exact: true }).click();
  await mario.getByRole("dialog", { name: `Take ${ref} over from Darlene?` }).getByRole("button", { name: "Take over", exact: true }).click();
  await expect(marioPanel.getByRole("region", { name: "Who has it" })).toHaveText(/With Mario/);

  await page.getByRole("dialog", { name: `Take ${ref} over from Darlene?` }).getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByText("Mario has just taken this over.")).toBeVisible();
  const detail = await getJson<Detail>(page, `/console/items/${ref}`);
  expect(detail.assignee?.name).toBe("Mario");
});

test("S13.15 On an item nobody has, Assign to me makes it yours and History reads 'Mario took this on'", async ({ page, signIn, team }) => {
  // The abuse phrase is routed to nobody (flagged for the Admins), so it starts without a holder.
  const ref = await raise(await team.as("Grace"), "Darlene is useless, the RAKE agent keeps crashing", ["Slowing me down", "I expected it to stay up but it crashed"]);
  await signIn("Mario");
  const panel = await openItem(page, ref);
  await expect(panel.getByRole("region", { name: "Who has it" })).toContainText("Nobody has it yet");
  await panel.getByRole("button", { name: "Assign to me", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Who has it" })).toHaveText(/With Mario/);
  await openActivity(panel, "History");
  await expect(panel.getByRole("tabpanel").getByRole("listitem").filter({ hasText: "Mario · Mario took this on" })).toHaveCount(1);
});

test("S13.16 A newly routed item says 'Auto-assigned to Darlene · owner of RAKE Agent' with an Auto marker on its card, both gone once approved", async ({ page, signIn, team }) => {
  const ref = await raiseBug(await team.as("Liam"), "rake-agent", "RAKE Agent forgets my language setting");
  await signIn("Chris");
  await page.goto("/console?inbox=open");
  const card = page.locator('[aria-roledescription^="Draggable card"]').filter({ hasText: new RegExp(`${ref}(?!\d)`) });
  await expect(card).toContainText("Auto");
  const panel = await openItem(page, ref);
  await expect(panel.getByRole("region", { name: "Who has it" })).toHaveText(/Auto-assigned to Darlene · owner of RAKE Agent/);

  await panel.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Who has it" })).toHaveText(/^Who has itWith Darlene$/);
  await page.keyboard.press("Escape");
  await expect(card).not.toContainText("Auto");
});

test("S13.17 An item saved with open gaps says 'Needs detail' on its card and panel until the person adds details", async ({ page, signIn, team }) => {
  const liam = await team.as("Liam");
  const ref = await raiseBug(liam, "rake-agent", "RAKE Agent loses my saved searches");
  // Approved, so it is on Darlene's board (an item awaiting approval has no column there).
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await signIn("Darlene");
  const panel = await openItem(page, ref);
  await expect(panel.getByText("Needs detail: ask for info first")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Board", exact: true }).click();
  const card = page.locator('[aria-roledescription^="Draggable card"]').filter({ hasText: new RegExp(`${ref}(?!\\d)`) });
  await expect(card).toContainText("Needs detail");

  await postJson(liam, `/feedback/${ref}/replies`, { body: "It happens after I sign out and back in" });
  await page.reload();
  await expect(card).not.toContainText("Needs detail");
});

test("S13.18 What came since you last looked shows as New reply on the list and card and New in the panel", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const liam = await team.as("Liam");
  const ref = await raiseBug(liam, "rake-agent", "RAKE Agent crashes when I open the safety manual");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);
  await postJson(page, `/console/items/${ref}/start`); // opens it: nothing on it is new yet
  await postJson(await team.as("Marc"), `/console/items/${ref}/note`, { body: "Please prioritise this one" });
  await postJson(liam, `/feedback/${ref}/replies`, { body: "It crashes on the second chapter" });

  await page.request.put("/api/console/view", { data: { view: "board" } });
  await page.goto("/console");
  await expect(page.locator('[aria-roledescription^="Draggable card"]').filter({ hasText: new RegExp(`${ref}(?!\\d)`) })).toContainText("New reply");
  await page.request.put("/api/console/view", { data: { view: "list" } });
  await page.goto("/console");
  await expect(page.getByRole("row", { name: new RegExp(ref) })).toContainText("New reply");

  const panel = await openItem(page, ref);
  await openActivity(panel, "Messages");
  for (const text of ["Please prioritise this one", "It crashes on the second chapter"]) {
    await expect(panel.getByRole("listitem").filter({ hasText: text }).getByText("New", { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  const again = await openItem(page, ref);
  await openActivity(again, "Messages");
  await expect(again.getByRole("listitem").filter({ hasText: "It crashes on the second chapter" })).toBeVisible();
  await expect(again.getByText("New", { exact: true })).toHaveCount(0);
  await page.request.put("/api/console/view", { data: { view: "board" } });
});

test("S13.19 History says Newest first and keeps the intake steps in the order they happened", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const ref = await raiseBug(await team.as("Liam"), "rake-agent", "RAKE Agent crashes when I search the forms list");
  const panel = await openItem(page, ref);
  await openActivity(panel, "History");
  const history = panel.getByRole("region", { name: "History" });
  await expect(history.getByRole("heading")).toContainText("Newest first");
  const lines = await history.getByRole("listitem").allTextContents();
  const oldest = lines.slice(-4);
  for (const [i, words] of ["Assigned to Darlene by routing", "Sent for approval", "Classified: Bug", "Received via chat"].entries()) {
    expect(oldest[i], `line ${i} of the last four`).toContain(words);
  }
});

test("S13.20 The recommendation and the Context time are in words, never raw values", async ({ page, signIn, team }) => {
  await signIn("Darlene");
  const context = { browser: "Chrome", time: "Tue Oct 27 2026 05:25:56 GMT+0800 (Philippine Standard Time)" };
  const ref = await raise(await team.as("Liam"), "RAKE Agent crashes when I open the incident form", ["Slowing me down", "I expected it to open but got a blank screen"], "rake-agent", context);
  const panel = await openItem(page, ref);
  const recommendation = panel.getByText(/^Recommendation:/).locator("..");
  await expect(recommendation).toContainText("Recommendation: Implement.");
  await expect(recommendation).toContainText("Affects one person.");
  await expect(recommendation).not.toContainText("_");
  const shown = panel.getByRole("definition").filter({ hasText: "Chrome" });
  // The hour follows the browser's time zone; the minutes and the app's date style don't.
  await expect(shown).toHaveText(/^Chrome · Tue,? 27 Oct,? \d{1,2}:25\s?[ap]m$/);
  await expect(shown).not.toContainText("GMT");
});
