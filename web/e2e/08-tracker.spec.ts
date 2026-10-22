import type { Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { pdf, postJson, raise, raiseBug } from "./helpers";

// Manual checklist section 8: the staff tracker (/track/FB-nnnn).

test.beforeAll(resetDatabase);

type Team = { as: (first: string) => Promise<Page> };

const TIME = /\d{1,2}:\d{2}/;
const SHORT_DATE = /\d{1,2} [A-Z][a-z]{2}/;

/** The staff member raises a plain RAKE Agent bug (Darlene's) and an Admin approves it. */
async function approvedBug(page: Page, team: Team, title: string) {
  const ref = await raiseBug(page, "rake-agent", title);
  await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
  return ref;
}

/** The server-sent events the chat endpoints return, as name and data. */
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

/** Like helpers.raise, but attaches files to the chat first, so the item is received "via chat, 1 file". */
async function raiseWithFile(page: Page, message: string, answers: string[], project: string, file: ReturnType<typeof pdf>) {
  const api = page.request;
  const start = await (await api.post("/api/chat/sessions", { data: { project_slug: project, context: {} } })).json();
  const upload = await api.post(`/api/chat/sessions/${start.session_id}/attachments`, { multipart: { file } });
  expect(upload.ok(), `upload -> ${upload.status()}`).toBeTruthy();
  const attachmentId = (await upload.json()).id as string;
  const say = async (text: string, attachment_ids: string[] = []) =>
    sse(await (await api.post(`/api/chat/sessions/${start.session_id}/messages`, { data: { text, attachment_ids } })).text());
  let evs = await say(message, [attachmentId]);
  for (const a of answers) {
    if (evs.some((e) => e.name === "draft")) break;
    evs = await say(a);
  }
  const draft = evs.find((e) => e.name === "draft");
  if (!draft) throw new Error(`No confirm card for: ${message}`);
  const confirm = await api.post(`/api/chat/sessions/${start.session_id}/confirm`, { data: { draft_hash: draft.data.hash } });
  const done = sse(await confirm.text()).find((e) => e.name === "done");
  if (!done) throw new Error(`Not saved: ${message}`);
  return done.data.reference as string;
}

/** The item's tracker page, loaded and showing its status heading. */
async function openTracker(page: Page, ref: string) {
  await page.goto(`/track/${ref}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const historyOf = (page: Page) => page.getByRole("region", { name: "Tracking history" });

test.describe("8. Staff: tracker", () => {
  test("S08.01 the tracker shows the status as the heading, the FB reference, tool and category, and Expected by once set", async ({
    page,
    signIn,
    team,
  }) => {
    await signIn("Liam");
    const ref = await raiseBug(page, "rake-agent");
    await openTracker(page, ref);

    // The charcoal band holds the heading, the reference chip and the tool and category line.
    const band = page.getByRole("heading", { level: 1 }).locator("..");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Received, waiting for approval");
    await expect(band).toContainText(ref);
    await expect(band).toContainText("RAKE Agent · Bug");
    await expect(band).not.toContainText("Expected by");

    await postJson(await team.as("Darlene"), `/console/items/${ref}/update`, { body: "", expected_by: "2026-12-23" });
    await page.reload();
    await expect(band).toContainText(/Expected by .*23/);
  });

  test("S08.02 the stepper shows Received, Approved, In progress, Resolved and Closed, with done, current and future stages marked", async ({
    page,
    signIn,
    team,
  }) => {
    await signIn("Liam");
    const ref = await approvedBug(page, team, "RAKE Agent crashes when I open the stepper item");
    await postJson(await team.as("Darlene"), `/console/items/${ref}/start`);
    await openTracker(page, ref);

    const stages = page.getByRole("region", { name: "Progress" }).getByRole("listitem");
    await expect(stages).toHaveCount(5);
    const names = ["Received", "Approved", "In progress", "Resolved", "Closed"];
    for (const [i, name] of names.entries()) await expect(stages.nth(i)).toContainText(name);

    // Done stages are filled with a tick, the current one is ringed, future ones are outlined.
    for (const i of [0, 1]) {
      await expect(stages.nth(i)).toContainText(", done");
      await expect(stages.nth(i).locator("svg")).toHaveCount(1);
      await expect(stages.nth(i).locator("span[title]")).toHaveClass(/bg-primary/);
    }
    await expect(stages.nth(2)).toContainText(", current stage");
    await expect(stages.nth(2).locator("span[title]")).toHaveClass(/ring-4/);
    await expect(stages.nth(2).locator("svg")).toHaveCount(0);
    for (const i of [3, 4]) {
      await expect(stages.nth(i)).toContainText(", not yet");
      await expect(stages.nth(i).locator("span[title]")).toHaveCount(0);
      await expect(stages.nth(i).locator("span.border-border")).toHaveCount(1);
    }

    // Reached stages show a date on desktop and the full time on hover (the circle's title).
    for (const i of [0, 1, 2]) {
      await expect(stages.nth(i)).toContainText(SHORT_DATE);
      await expect(stages.nth(i).locator("span[title]")).toHaveAttribute("title", TIME);
    }
    for (const i of [3, 4]) await expect(stages.nth(i)).not.toContainText(SHORT_DATE);
  });

  test("S08.03 Who has it names the assignee and role, with an email button that uses the FB number as the subject", async ({
    page,
    signIn,
    team,
  }) => {
    await signIn("Liam");
    const ref = await approvedBug(page, team, "RAKE Agent crashes when I check who has it");
    await openTracker(page, ref);

    const who = page.getByRole("region", { name: "Who has it" });
    await expect(who).toContainText("Darlene");
    await expect(who).toContainText("Digital Staff · RAKE Agent owner");
    const email = who.getByRole("link", { name: "Email Darlene" });
    await expect(email).toHaveAttribute("href", /^mailto:[^?]+\?subject=/);
    await expect(email).toHaveAttribute("href", new RegExp(`subject=${ref}$`));
  });

  test("S08.04 a Needs review item says the Digital team is checking who it belongs to", async ({ page, signIn }) => {
    await signIn("Liam");
    const ref = await raise(page, "The export button is broken and it's annoying", ["Not sure", "I expected it to export but got an error"]);
    await openTracker(page, ref);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Received, being checked");
    await expect(page.getByRole("region", { name: "Who has it" })).toContainText("The Digital team is checking who it belongs to.");
  });

  test("S08.05 after Darlene posts an update, Latest update shows the text, Darlene and the time", async ({ page, signIn, team }) => {
    await signIn("Liam");
    const ref = await approvedBug(page, team, "RAKE Agent crashes when I wait for an update");
    await openTracker(page, ref);
    const latest = page.getByRole("region", { name: "Latest update" });
    await expect(latest).toHaveCount(0);

    await postJson(await team.as("Darlene"), `/console/items/${ref}/update`, { body: "Found the cause; the fix is in testing." });
    await page.reload();
    await expect(latest).toContainText("Found the cause; the fix is in testing.");
    await expect(latest).toContainText("Darlene");
    await expect(latest).toContainText(TIME);
  });

  test("S08.06 the history runs newest first, newest highlighted and older greyed, each with date and time", async ({
    page,
    signIn,
    team,
  }) => {
    test.setTimeout(90_000);
    await signIn("Liam");
    const darlene = await team.as("Darlene");
    // Raised with a file and a Blocking answer, so the first entries read "1 file" and "P1".
    const ref = await raiseWithFile(
      page,
      "RAKE Agent crashes when I walk the lifecycle",
      ["Blocking my work", "I expected it to open but got a blank screen"],
      "rake-agent",
      pdf("evidence.pdf"),
    );
    // Each step is its own request, so the order on the tracker is the order here.
    await postJson(await team.as("Marc"), `/console/items/${ref}/approve`);
    expect((await darlene.request.get(`/api/console/items/${ref}`)).ok()).toBeTruthy(); // the assignee opens it
    await postJson(darlene, `/console/items/${ref}/start`);
    await postJson(darlene, `/console/items/${ref}/update`, { body: "", expected_by: "2026-12-23" });
    await postJson(darlene, `/console/items/${ref}/update`, { body: "Found the cause; the fix is in testing." });
    await postJson(page, `/feedback/${ref}/replies`, { body: "It also fails on my phone" });
    await postJson(darlene, `/console/items/${ref}/resolve`, { body: "Fix deployed" });

    await openTracker(page, ref);
    await page.getByRole("button", { name: /See full history/ }).click();
    const items = historyOf(page).getByRole("listitem");
    const texts = await items.allInnerTexts();
    const at = (start: string) => {
      const i = texts.findIndex((t) => t.startsWith(start));
      expect(i, `no history entry starting "${start}"`).toBeGreaterThanOrEqual(0);
      return i;
    };

    // Newest first. Resolving writes two entries (the note and the stage) in one moment, so they share the top.
    expect(at("Resolved: Fix deployed")).toBeLessThan(2);
    expect(at("Update: Fix deployed")).toBeLessThan(2);
    const order = [
      at("You added details"),
      at("Update: Found the cause"),
      at("Expected by"),
      at("Darlene started work"),
      at("Darlene opened your feedback"),
      at("Approved by Marc"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(1);
    // The three entries written when it was raised come last.
    for (const first of ["Received via chat, 1 file", "Classified: Bug, P1, RAKE Agent", "Assigned to Darlene"]) {
      expect(at(first)).toBeGreaterThan(order[order.length - 1]);
    }

    // The newest is highlighted and the rest are greyed.
    await expect(items.first().locator("p").first()).toHaveClass(/font-semibold/);
    await expect(items.first().locator("div").first()).not.toHaveClass(/text-muted-foreground/);
    await expect(items.nth(1).locator("p").first()).not.toHaveClass(/font-semibold/);
    await expect(items.nth(1).locator("div").first()).toHaveClass(/text-muted-foreground/);

    // Every entry has its date and time.
    const stamps = historyOf(page).locator("time");
    await expect(stamps).toHaveCount(texts.length);
    for (const stamp of await stamps.all()) {
      await expect(stamp).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
      await expect(stamp).toHaveText(TIME);
    }
  });

  test("S08.07 with more than four entries, See full history shows every entry and Show less collapses", async ({ page, signIn, team }) => {
    await signIn("Liam");
    const ref = await approvedBug(page, team, "RAKE Agent crashes when I count the history");
    const darlene = await team.as("Darlene");
    await postJson(darlene, `/console/items/${ref}/start`);
    await postJson(darlene, `/console/items/${ref}/update`, { body: "One" });
    await openTracker(page, ref);

    const items = historyOf(page).getByRole("listitem");
    await expect(items).toHaveCount(4);
    const seeAll = page.getByRole("button", { name: /^See full history \(\d+\)$/ });
    const total = Number((await seeAll.innerText()).match(/\((\d+)\)/)![1]);
    expect(total).toBeGreaterThan(4);

    await seeAll.click();
    await expect(items).toHaveCount(total);
    await page.getByRole("button", { name: "Show less" }).click();
    await expect(items).toHaveCount(4);
    await expect(seeAll).toBeVisible();
  });

  test("S08.08 an internal note and a corrected field never appear on the tracker", async ({ page, signIn, team }) => {
    await signIn("Liam");
    const ref = await approvedBug(page, team, "RAKE Agent crashes when I hide the notes");
    // Opening the item writes its own "opened your feedback" entry, so Darlene opens it before the history is read.
    const darlene = await team.as("Darlene");
    expect((await darlene.request.get(`/api/console/items/${ref}`)).ok()).toBeTruthy();
    const items = historyOf(page).getByRole("listitem");
    const fullHistory = async () => {
      await openTracker(page, ref);
      await page.getByRole("button", { name: /See full history/ }).click();
      return items.allInnerTexts();
    };
    const before = await fullHistory();
    expect(before.length).toBeGreaterThan(4);

    await postJson(darlene, `/console/items/${ref}/note`, { body: "Internal: cache key bug" });
    const fix = await darlene.request.patch(`/api/console/items/${ref}`, { data: { category: "usability" } });
    expect(fix.ok(), `PATCH -> ${fix.status()}`).toBeTruthy();

    // The correction did land (the category line changed), yet neither it nor the note is shown.
    expect(await fullHistory()).toEqual(before);
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Usability");
    await expect(page.getByRole("region", { name: "Latest update" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("cache key bug");
    await expect(historyOf(page)).not.toContainText(/correct/i);
  });

  test("S08.09 What you sent shows the title, summary, priority and attachments, and a file opens in a new tab", async ({ page, signIn }) => {
    await signIn("Liam");
    // Longer than 80 characters, so the title is cut short and the summary shows the whole sentence.
    const message = "RAKE Agent crashes when I upload a large file to the shared folder and the progress bar never finishes at all today";
    const ref = await raiseWithFile(page, message, ["Slowing me down", "I expected it to upload but got an error"], "rake-agent", pdf("report.pdf"));
    await openTracker(page, ref);

    const sent = page.getByRole("region", { name: "What you sent" });
    await expect(sent.getByText(/^RAKE Agent crashes when I upload a large file.*\.\.\.$/)).toBeVisible();
    await expect(sent.getByText(message, { exact: true })).toBeVisible();
    await expect(sent).toContainText("Major");
    const file = sent.getByRole("link", { name: /report\.pdf/ });
    await expect(file).toBeVisible();
    await expect(file).toHaveAttribute("target", "_blank");

    const [popup] = await Promise.all([page.waitForEvent("popup"), file.click()]);
    expect(popup).toBeTruthy();
    // The link hands out a signed link to the stored file.
    const stored = await page.request.get((await file.getAttribute("href"))!);
    expect(stored.ok()).toBeTruthy();
    expect(stored.headers()["content-type"]).toContain("application/pdf");
  });

  test("S08.10 a declined, a won't-fix and a merged item explain themselves", async ({ page, signIn, team }) => {
    test.setTimeout(90_000);
    await signIn("Liam");
    const marc = await team.as("Marc");
    const darlene = await team.as("Darlene");

    const declined = await raiseBug(page, "rake-agent", "RAKE Agent crashes when I ask for gold paper");
    await postJson(marc, `/console/items/${declined}/decline`, { reason: "Out of scope for this quarter" });
    await openTracker(page, declined);
    await expect(page.getByText("Reason: Out of scope for this quarter")).toBeVisible();

    const wontFix = await approvedBug(page, team, "RAKE Agent crashes when I print in colour");
    await postJson(darlene, `/console/items/${wontFix}/close`, { reason: "Working as designed", wont_fix: true });
    await openTracker(page, wontFix);
    await expect(page.getByText("Reason: Won't fix: Working as designed")).toBeVisible();

    const original = await approvedBug(page, team, "RAKE Agent crashes when I save the original");
    const copy = await approvedBug(page, team, "RAKE Agent crashes when I save the copy");
    await postJson(marc, `/console/items/${copy}/merge`, { into: original });
    await openTracker(page, copy);
    await expect(page.getByText(`Merged into ${original}. Follow that one for updates.`)).toBeVisible();
    await expect(page.getByText("Reason:")).toHaveCount(0);
    await page.getByRole("link", { name: original, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/track/${original}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Approved, ready to start");
  });

  test("S08.11 an unknown reference shows We can't find that feedback with a link to My feedback", async ({ page, signIn }) => {
    await signIn("Liam");
    await page.goto("/track/FB-9999");
    await expect(page.getByRole("heading", { name: "We can't find that feedback" })).toBeVisible();
    const link = page.getByRole("link", { name: "Go to My feedback" });
    await link.click();
    await expect(page).toHaveURL(/\/my$/);
  });

  test("S08.12 staff opening someone else's item get the same We can't find that feedback page", async ({ page, signIn, team }) => {
    await signIn("Liam");
    const marios = await raiseBug(await team.as("Mario"), "rake-agent", "RAKE Agent crashes for Mario only");
    await page.goto(`/track/${marios}`);
    await expect(page.getByRole("heading", { name: "We can't find that feedback" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to My feedback" })).toBeVisible();
    await expect(page.getByText("RAKE Agent crashes for Mario only")).toHaveCount(0);
  });
});
