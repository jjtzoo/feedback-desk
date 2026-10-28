import { expect, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";

import { API_CONTROL, TOUR_SEEN, WEB } from "./env";

export type Person = { email: string; name: string; role: "admin" | "digital" | "staff" };

let people: Person[] | null = null;

/** The seeded people the local sign-in box lists, looked up by first name. */
export async function person(request: APIRequestContext, first: string): Promise<Person> {
  if (!people) people = (await (await request.get("/api/auth/dev/users")).json()) as Person[];
  const found = people.find((p) => p.name.split(" ")[0] === first);
  if (!found) throw new Error(`No dev person called ${first}`);
  return found;
}

/** Sign in through the same call the local sign-in box makes; the cookie lands on the page's context. */
export async function signInAs(page: Page, first: string) {
  const who = await person(page.request, first);
  const r = await page.request.post("/api/auth/dev/sign-in", { data: { email: who.email } });
  expect(r.status()).toBe(204);
  return who;
}

export async function signOut(page: Page) {
  await page.request.post("/api/auth/signout");
  await page.context().clearCookies();
}

/** A second signed-in person in their own browser window, for "as Darlene, in a private window". */
export async function otherWindow(browser: Browser, first: string) {
  const context = await browser.newContext({ baseURL: WEB, storageState: TOUR_SEEN });
  const page = await context.newPage();
  const who = await signInAs(page, first);
  return { page, context, who, close: () => context.close() };
}

/** Playwright's API requests have no time limit of their own; a hung one should fail here, not at the test's. */
const TIMEOUT = 30_000;

/** Read the API's JSON as the signed-in person. */
export async function getJson<T = unknown>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(`/api${path}`, { timeout: TIMEOUT });
  expect(r.ok(), `GET ${path} -> ${r.status()}`).toBeTruthy();
  return (await r.json()) as T;
}

export async function postJson<T = unknown>(page: Page, path: string, data: unknown = {}, ok = true): Promise<T> {
  const r = await page.request.post(`/api${path}`, { data, timeout: TIMEOUT });
  if (ok) expect(r.ok(), `POST ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json().catch(() => ({}))) as T;
}

/** The first name of whoever has an item: only they start work on it, post updates and resolve it (D53). */
/** The item panel's Status button (D91), named for where the item is: "Status: In progress". */
export const statusButton = (panel: Locator) => panel.locator("header").getByRole("button", { name: /^Status: / });

/** Open the panel's Status menu and pick a move: "Start work", "Resolve…", "Close…", "Close as fixed…", "Start work again". */
export async function moveTo(page: Page, panel: Locator, label: string) {
  await statusButton(panel).click();
  await page.getByRole("menu").getByRole("menuitem", { name: label, exact: true }).click();
}

/** The moves the Status menu offers, in order; the menu is closed again afterwards. */
export async function statusMoves(page: Page, panel: Locator): Promise<string[]> {
  await statusButton(panel).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const moves = await menu.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return moves.map((m) => m.trim());
}

export async function holderOf(page: Page, ref: string) {
  const item = await getJson<{ assignee: { name: string } | null }>(page, `/console/items/${ref}`);
  return item.assignee!.name.split(" ")[0];
}

/** Parse the server-sent events the chat endpoints return. */
function events(body: string): { name: string; data: Record<string, unknown> }[] {
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

/**
 * Raise feedback as the signed-in person without the screen, to set up what a test then looks at.
 * `context` is what the page would send with the chat (device, browser, time).
 * Answers any question the stub asks until the card shows (a yes to "Want me to send that to the team?"
 * for praise and questions, D64), then confirms. Returns the reference.
 */
export async function raise(page: Page, message: string, answers: string[] = [], project: string | null = null, context: Record<string, string> = {}) {
  const api = page.request;
  // Every response is kept, so a failed setup says what the API actually sent back.
  const seen: string[] = [];
  const opened = await api.post("/api/chat/sessions", { data: { project_slug: project, context }, timeout: TIMEOUT });
  const startBody = await opened.text();
  seen.push(`start ${opened.status()} ${startBody.slice(0, 300)}`);
  const start = opened.ok() ? (JSON.parse(startBody) as { session_id?: string; mode?: string }) : {};
  if (!start.session_id) throw new Error(`No chat for: ${message}\n${seen.join("\n")}`);
  const say = async (text: string) => {
    const r = await api.post(`/api/chat/sessions/${start.session_id}/messages`, { data: { text, attachment_ids: [] }, timeout: TIMEOUT });
    const body = await r.text();
    const evs = r.ok() ? events(body) : [];
    seen.push(`say ${r.status()} ${r.ok() ? evs.map((e) => e.name).join(",") : body.slice(0, 300)}`);
    return evs;
  };
  let evs = await say(message);
  for (const a of answers) {
    if (evs.some((e) => e.name === "draft")) break;
    evs = await say(a);
  }
  if (evs.some((e) => e.name === "message" && String(e.data.text).includes(SEND_CHECK))) evs = await say("Yes, send it to the team");
  const draft = evs.find((e) => e.name === "draft");
  if (!draft) throw new Error(`No confirm card for: ${message}\n${seen.join("\n")}`);
  const done = events(
    await (await api.post(`/api/chat/sessions/${start.session_id}/confirm`, { data: { draft_hash: draft.data.hash }, timeout: TIMEOUT })).text(),
  ).find((e) => e.name === "done");
  if (!done) throw new Error(`Not saved: ${message}`);
  return done.data.reference as string;
}

/** Sig's check before the card for praise and questions (D64). */
export const SEND_CHECK = "Want me to send that to the team?";

/** The phrase from the manual checklist that steers the model to a plain bug. */
export const BUG = "The Training Portal shows an error when I open my certificate";
export const BUG_ANSWERS = ["Slowing me down", "I expected my certificate to open but got a blank screen"];

/** Raise a plain bug about a given tool. */
export async function raiseBug(page: Page, project: string, title = "The page shows an error when I open it") {
  return raise(page, title, ["Slowing me down", "I expected it to open but got a blank screen"], project);
}

/** A PDF-looking file in memory, so the specs need no sample files on disk. */
export function pdf(name: string, bytes = 400) {
  const head = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  return { name, mimeType: "application/pdf", buffer: Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 32)]) };
}

/** A real one-pixel PNG, so the upload's content check passes. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** Paste into a box the way Ctrl+V of a screenshot does: a clipboard holding a picture called image.png and no text. */
export async function pasteImage(box: Locator, text = "") {
  await box.evaluate(
    (el, { bytes, text }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
      if (text) dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { bytes: Array.from(PNG), text },
  );
}

type Dropped = { name: string; mimeType: string; buffer: Buffer };

/** Drag files over the chat the way a person drags them from File Explorer; `hold` stops before the drop. */
export async function dropOnChat(page: Page, files: Dropped[], hold = false) {
  const handle = await page.evaluateHandle(
    (list) => {
      const dt = new DataTransfer();
      for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }));
      return dt;
    },
    files.map((f) => ({ name: f.name, mimeType: f.mimeType, bytes: Array.from(f.buffer) })),
  );
  const target = page.getByRole("region", { name: /Chat with Sig/ }).locator("div.relative").first();
  await target.dispatchEvent("dragover", { dataTransfer: handle });
  if (!hold) await target.dispatchEvent("drop", { dataTransfer: handle });
}

/** Send a message in the chat and wait for Sig to finish answering. */
export async function chatSay(page: Page, text: string) {
  const box = page.getByLabel("Your message");
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText("Sig is writing…")).toHaveCount(0, { timeout: 20_000 });
}

type ApiModel = { provider: "stub" | "none"; pid: number };

async function control(method: "GET" | "POST", body?: unknown): Promise<ApiModel> {
  const r = await fetch(`${API_CONTROL}/model`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(150_000),
  }).catch((e) => {
    throw new Error(`No test API supervisor on ${API_CONTROL}; restart the test servers. ${e}`);
  });
  if (!r.ok) throw new Error(`${method} /model -> ${r.status} ${await r.text()}`);
  return (await r.json()) as ApiModel;
}

/** Which model the test API runs with, and its process. */
export const apiModel = () => control("GET");

/** Really restart the test API (a new process, same database) with this MODEL_PROVIDER; resolves once it is healthy. */
export const restartApi = (provider: "stub" | "none") => control("POST", { provider });

/** The model a page gets: the API's health as the web server's /api proxy reaches it. */
export async function providerViaWeb(page: Page) {
  const r = await page.request.get("/api/health").catch(() => null);
  return r?.ok() ? ((await r.json()) as { model: { provider: string } }).model.provider : null;
}

/** Get to the backup form the way a person does: thirteen messages without confirming. */
export async function reachBackupForm(page: Page) {
  await page.goto("/chat");
  await expect(page.getByText(/I'm Sig/)).toBeVisible();
  for (let i = 1; i <= 13; i++) {
    if (await page.getByText("Sorry, this is taking longer than it should.").isVisible()) break;
    await chatSay(page, `typed note number ${i}`);
  }
  await expect(page.getByText("Sorry, this is taking longer than it should.")).toBeVisible({ timeout: 20_000 });
}

/** Answer Sig's questions (impact chip or Yes, send it, then expected and actual) until the confirm card shows. */
export async function answerUntilCard(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (await page.getByRole("button", { name: "Confirm" }).isVisible()) return;
    const impact = page.getByRole("button", { name: "Slower, but I get there" });
    const send = page.getByRole("button", { name: "Yes, send it" });
    if (await impact.isVisible()) await impact.click();
    else if (await send.isVisible()) await send.click();
    else await chatSay(page, "I expected it to work but got a blank screen");
    await expect(page.getByText("Sig is writing…")).toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
}

/** Open the console panel's Activity tab, showing everything, only messages or only history. */
export async function openActivity(panel: Locator, show: "All" | "Messages" | "History" = "All") {
  await panel.getByRole("tab", { name: "Activity" }).click();
  await panel.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: show, exact: true }).click();
}
