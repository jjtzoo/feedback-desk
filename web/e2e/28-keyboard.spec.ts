import type { JSHandle, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, postJson, raiseBug } from "./helpers";

// Manual checklist section 28: the app used with the keyboard alone.

test.beforeAll(resetDatabase);

const EXPECTED = "I expected it to open but got a blank screen";

// People are spread over the tests: the API allows 20 chats per person per hour.

/** Where one Tab press landed, and how the control looks while it has focus. */
type Stop = { tag: string; name: string; outline: boolean; shadow: string; rest: string | null; w: number; h: number };

/** What a screen-reader user would be told about the focused control, plus the focus ring it is drawing. */
function describeFocus(el: Element | null) {
  const e = el as HTMLElement;
  const style = getComputedStyle(e);
  const box = e.getBoundingClientRect();
  const label = (e as HTMLInputElement).labels?.[0]?.textContent;
  const name = e.getAttribute("aria-label") || label || e.textContent || e.getAttribute("title") || e.id || e.getAttribute("type") || "";
  return {
    tag: e.tagName.toLowerCase(),
    name: name.replace(/\s+/g, " ").trim().slice(0, 80),
    outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
    shadow: style.boxShadow,
    w: box.width,
    h: box.height,
  };
}

/** Controls fade their ring in; wait for that to finish (or give up after a second) before reading it. */
function settled(el: Element | null) {
  const done = Promise.all((el as Element).getAnimations().map((a) => a.finished.then(() => undefined, () => undefined)));
  return Promise.race([done, new Promise((resolve) => setTimeout(resolve, 1000))]).then(() => undefined);
}

/** Press Tab from the top of the page until focus leaves the page or comes round to the first control. */
async function tabStops(page: Page, limit = 70): Promise<Stop[]> {
  const stops: Stop[] = [];
  let last: JSHandle<Element | null> | null = null;
  const measureRest = async () => {
    // The control just left no longer has focus, so its shadow now is its shadow without a ring.
    if (!last) return;
    await last.evaluate(settled);
    stops[stops.length - 1].rest = await last.evaluate((el) => getComputedStyle(el as Element).boxShadow);
  };
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    await measureRest();
    last = null;
    const here = await page.evaluateHandle(() => document.activeElement);
    if (await here.evaluate((el) => el === null || el === document.body)) break;
    await here.evaluate(settled);
    const stop: Stop = { ...(await here.evaluate(describeFocus)), rest: null };
    if (stops.length > 0 && stop.tag === stops[0].tag && stop.name === stops[0].name) break;
    stops.push(stop);
    last = here;
  }
  if (last) {
    await page.keyboard.press("Tab");
    await measureRest();
  }
  return stops;
}

const label = (s: Stop) => `${s.tag} "${s.name}" (${Math.round(s.w)} x ${Math.round(s.h)})`;

/** Every stop draws a ring: an outline, or a shadow the control only has while it is focused, on a control big enough to show one. */
function expectRings(stops: Stop[]) {
  const bad = stops.filter((s) => !(s.outline || s.shadow !== s.rest) || s.w < 14 || s.h < 14);
  expect(bad.map(label), "controls reached by Tab with no visible focus ring").toEqual([]);
}

/** The named controls are all reached, one after the other in this order (other stops may sit between them). */
function expectOrder(stops: Stop[], wanted: (string | RegExp)[]) {
  let from = 0;
  const missing: string[] = [];
  for (const w of wanted) {
    const at = stops.findIndex((s, i) => i >= from && (typeof w === "string" ? s.name === w : w.test(s.name)));
    if (at < 0) missing.push(String(w));
    else from = at + 1;
  }
  expect(missing, `not reached in this order; Tab went: ${stops.map((s) => s.name).join(" > ")}`).toEqual([]);
}

const HEADER = ["Give feedback", "My feedback", "Fixes and updates", "Guide", /^Notifications/];

const card = (page: Page) => page.getByRole("region", { name: "Your feedback" });

async function openChat(page: Page) {
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
}

/** Describe it, choose how much it affects the person, say what was expected: the confirm card shows. */
async function reachCard(page: Page, description: string) {
  await openChat(page);
  await chatSay(page, description);
  await page.getByRole("button", { name: "Slower, but I get there", exact: true }).click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, EXPECTED);
  await expect(card(page)).toBeVisible();
}

test("S28.01 Tab through the landing page, chat, tracker and console: a visible focus ring on every control, in a sensible order", async ({ page, signIn, team }) => {
  test.setTimeout(120_000);
  await signIn("Liam");
  // An approved item, so the landing page lists it, the tracker has an owner and the board has a card.
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent shows an error when I tab through it");
  await postJson(await team.as("Chris"), `/console/items/${ref}/approve`);

  await page.goto("/");
  await expect(page.getByRole("link", { name: new RegExp(ref) })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Already know which tool?" })).toBeVisible();
  const landing = await tabStops(page);
  expectOrder(landing, [
    "Smoke Signal",
    ...HEADER,
    "Account: Liam Carter",
    /^Give feedback/,
    /^Something's broken/,
    /^I need access/,
    /^I have an idea/,
    /^How do I/,
    /^Choose a tool/,
    /^View all/,
    new RegExp(ref),
  ]);
  expectRings(landing);

  await openChat(page);
  const chat = await tabStops(page);
  expectOrder(chat, ["Smoke Signal", ...HEADER, "Account: Liam Carter", /^Attach a file/, "Your message"]);

  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const tracker = await tabStops(page);
  expectOrder(tracker, [
    "Smoke Signal",
    ...HEADER,
    "Account: Liam Carter",
    "My feedback",
    /^Mute notifications for this item/,
    /^Your messages go to /,
  ]);
  expectRings(tracker);

  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  await expect(darlene.locator("button", { hasText: ref })).toBeVisible();
  const work = await tabStops(darlene);
  expectOrder(work, [
    "Smoke Signal",
    "Smoke Signal home",
    "Guide",
    /^Notifications/,
    /^Account: Darlene/,
    "Work",
    /^Assigned to me/,
    /^Triage/,
    /^Overdue/,
    "Channels",
    "Releases",
    "Dashboard",
    "Admin",
    // The view switch and the inbox tabs are each one Tab stop; the arrow keys move inside them.
    "Board",
    /^Assigned to me/,
    "Search",
    "Filter",
    new RegExp(ref),
  ]);
  expectRings(work);

  // Last, so the pages above are still checked while this is a known bug: the chat's hidden file input is a Tab stop with no ring.
  expectRings(chat);
});

test("S28.02 In the chat, focus moves to the 'Your feedback' heading when the card shows, then to the 'Sent' heading after Confirm", async ({ page, signIn }) => {
  await signIn("Aisha");
  await reachCard(page, "The Training Portal shows an error when I open the certificate for my course");
  await expect(page.getByRole("heading", { name: "Your feedback" })).toBeFocused();

  // From the heading, Tab passes the box for what Sig couldn't find out (D63; its Add button is off
  // while the box is empty), reaches Confirm, and Enter presses it: the whole way needs no mouse.
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Add what you know")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ })).toBeFocused();
});

test("S28.03 Esc closes a dialog and focus returns to the button that opened it; Tab stays inside while it is open", async ({ page, signIn, team }) => {
  await signIn("Chris");
  // An item waiting for approval gives Chris a Decline button on the Approvals page.
  const ref = await raiseBug(await team.as("Tom"), "rake-agent", "RAKE Agent shows an error when I press escape");
  await page.goto("/console/approvals");
  const article = page.getByRole("article").filter({ hasText: ref });
  const decline = article.getByRole("button", { name: "Decline", exact: true });
  await expect(decline).toBeVisible();

  await decline.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Decline" });
  await expect(dialog).toBeVisible();
  const insideDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  await expect.poll(insideDialog).toBe(true);

  // Tab and Shift+Tab go round the dialog's own controls and never out to the page behind it.
  const visited = new Set<string>();
  const here = () => page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.trim()}`);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await insideDialog(), `Tab ${i + 1} left the dialog`).toBe(true);
    visited.add(await here());
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog(), `Shift+Tab ${i + 1} left the dialog`).toBe(true);
    visited.add(await here());
  }
  expect(visited.size, "Tab moved between the dialog's controls").toBeGreaterThan(2);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(article).toBeVisible(); // closing did not decline it
  await expect(decline).toBeFocused();
});

test("S28.04 A select, a switch and a radio button all work with the keyboard alone", async ({ page, signIn, team }) => {
  test.setTimeout(90_000);

  // Select: on the landing page, Enter opens "Already know which tool?", the arrows move, Enter picks.
  await signIn("Mei");
  await page.goto("/");
  const tool = page.getByRole("combobox", { name: "Already know which tool?" });
  await expect(tool).toBeVisible();
  await tool.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  const focusedOption = () => page.evaluate(() => (document.activeElement?.getAttribute("role") === "option" ? document.activeElement.textContent?.trim() ?? "" : ""));
  await expect.poll(focusedOption).not.toBe("");
  const first = await focusedOption();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => ![first, ""].includes(await focusedOption())).toBe(true);
  const chosen = await focusedOption();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\?project=[\w-]+$/);
  await expect(page.getByText(`About ${chosen}`, { exact: true })).toBeVisible();

  // Switch and select on the Admin page, as Chris: Tabs by arrow key, Space on the switch, the same keys as above on the role picker.
  await signIn("Chris");
  await page.goto("/console/admin");
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Projects/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Digital Staff/ })).toHaveAttribute("aria-selected", "true");

  type Staff = { name: string; role: string; is_away: boolean };
  const mario = async () => (await getJson<Staff[]>(page, "/admin/digital-staff")).find((s) => s.name === "Mario")!;
  const away = page.getByRole("switch", { name: "is away: Mario" });
  await expect(away).not.toBeChecked();
  await away.focus();
  await page.keyboard.press("Space");
  await expect(away).toBeChecked();
  await expect.poll(async () => (await mario()).is_away).toBe(true);
  await away.focus();
  await page.keyboard.press("Space");
  await expect(away).not.toBeChecked();
  await expect.poll(async () => (await mario()).is_away).toBe(false);

  const role = page.getByRole("combobox", { name: "Role for Mario" });
  await expect(role).toHaveText("Digital Staff");
  await role.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Digital Staff" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Admin" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(role).toHaveText("Admin");
  await expect.poll(async () => (await mario()).role).toBe("admin");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await role.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Admin" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "Digital Staff" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(role).toHaveText("Digital Staff");
  await expect.poll(async () => (await mario()).role).toBe("digital");

  // Radio: the endings in the Close dialog of an item's panel, chosen with Space and the arrow keys.
  const ref = await raiseBug(await team.as("Rafael"), "rake-agent", "RAKE Agent shows an error when I use a checkbox");
  await page.goto(`/console?inbox=open&item=${ref}`);
  const header = page.locator("header", { hasText: ref });
  await expect(header).toBeVisible();
  // The Status menu opens with Enter and its moves are picked with the arrow keys (D91).
  await header.getByRole("button", { name: /^Status: / }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Close…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Close", exact: true });
  await expect(dialog).toBeVisible();
  const wontFix = dialog.getByRole("radio", { name: /Won't fix/ });
  const noLongerNeeded = dialog.getByRole("radio", { name: /No longer needed/ });
  await expect(wontFix).not.toBeChecked();
  await wontFix.focus();
  await page.keyboard.press("Space");
  await expect(wontFix).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(noLongerNeeded).toBeChecked();
  await expect(wontFix).not.toBeChecked();
});

test("S28.05 Status never relies on colour: badges carry a word, the stepper and the unread dots carry screen-reader text", async ({ page, signIn, team }) => {
  test.setTimeout(90_000);
  await signIn("Grace");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent shows an error when I check the status");
  const chris = await team.as("Chris");

  // Badges: each is a word beside an icon that screen readers skip.
  await chris.goto("/console/approvals");
  const article = chris.getByRole("article").filter({ hasText: ref });
  await expect(article).toBeVisible();
  const badges = article.locator("span.inline-flex.rounded-full");
  await expect(badges).toHaveText(["P2 · Major", "Awaiting approval"]);
  const icons = badges.locator("svg");
  await expect(icons).toHaveCount(2);
  for (const icon of await icons.all()) await expect(icon).toHaveAttribute("aria-hidden", "true");

  // Stepper: every stage says whether it is done, current or not yet, in words only a screen reader hears.
  await postJson(chris, `/console/items/${ref}/approve`);
  await page.goto(`/track/${ref}`);
  const stages = page.getByRole("region", { name: "Progress" }).getByRole("listitem");
  await expect(stages).toHaveCount(5);
  const spoken = [", done", ", current stage", ", not yet", ", not yet", ", not yet"];
  for (const [i, words] of spoken.entries()) await expect(stages.nth(i).locator(".sr-only")).toHaveText(words);

  // The bell's unread count is in its name, and each unread notification says "Unread" beside its dot.
  const bell = page.getByRole("banner").getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const approved = page.getByRole("link", { name: new RegExp(`${ref} is planned`) });
  await expect(approved).toBeVisible();
  await expect(approved).toHaveAccessibleName(/Unread/);
  await expect(approved.locator(".sr-only")).toHaveText("Unread");

  // The card's unread-reply dot has a name too (the item stays unopened, so the reply is unread).
  await postJson(page, `/feedback/${ref}/replies`, { body: "It also fails on my phone" });
  const darlene = await team.as("Darlene");
  await darlene.goto("/console");
  const onBoard = darlene.locator("button", { hasText: ref });
  await expect(onBoard).toBeVisible();
  await expect(onBoard.getByText("P2 · Major", { exact: true })).toBeVisible();
  await expect(onBoard.getByText("New reply")).toBeVisible();
});
