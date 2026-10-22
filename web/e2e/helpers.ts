import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { TOUR_SEEN, WEB } from "./env";

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

/** Read the API's JSON as the signed-in person. */
export async function getJson<T = unknown>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(`/api${path}`);
  expect(r.ok(), `GET ${path} -> ${r.status()}`).toBeTruthy();
  return (await r.json()) as T;
}

export async function postJson<T = unknown>(page: Page, path: string, data: unknown = {}, ok = true): Promise<T> {
  const r = await page.request.post(`/api${path}`, { data });
  if (ok) expect(r.ok(), `POST ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json().catch(() => ({}))) as T;
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
 * Answers any question the stub asks until the card shows, then confirms. Returns the reference.
 */
export async function raise(page: Page, message: string, answers: string[] = [], project: string | null = null) {
  const api = page.request;
  const start = await (await api.post("/api/chat/sessions", { data: { project_slug: project, context: {} } })).json();
  const say = async (text: string) =>
    events(await (await api.post(`/api/chat/sessions/${start.session_id}/messages`, { data: { text, attachment_ids: [] } })).text());
  let evs = await say(message);
  for (const a of answers) {
    if (evs.some((e) => e.name === "draft")) break;
    evs = await say(a);
  }
  const draft = evs.find((e) => e.name === "draft");
  if (!draft) throw new Error(`No confirm card for: ${message}`);
  const done = events(
    await (await api.post(`/api/chat/sessions/${start.session_id}/confirm`, { data: { draft_hash: draft.data.hash } })).text(),
  ).find((e) => e.name === "done");
  if (!done) throw new Error(`Not saved: ${message}`);
  return done.data.reference as string;
}

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

/** Answer Sig's questions (impact chip, then expected and actual) until the confirm card shows. */
export async function answerUntilCard(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (await page.getByRole("button", { name: "Confirm" }).isVisible()) return;
    const impact = page.getByRole("button", { name: "Slowing me down" });
    if (await impact.isVisible()) await impact.click();
    else await chatSay(page, "I expected it to work but got a blank screen");
    await expect(page.getByText("Sig is writing…")).toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
}
