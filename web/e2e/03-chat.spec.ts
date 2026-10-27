import { execSync } from "node:child_process";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { BUG, PNG, chatSay, dropOnChat, getJson, pasteImage, pdf, postJson, raiseBug, reachBackupForm } from "./helpers";

// Manual checklist section 3: the staff chat, with the scripted stub model (its fixed phrases are in backend/agent/stub.py).

test.beforeAll(resetDatabase);

const MACRO = { name: "macro-test.docm", mimeType: "application/vnd.ms-word.document.macroEnabled.12", buffer: Buffer.from("PK\u0003\u0004") };

/** A real Word and Excel file, made by the backend's own libraries so the upload's content checks pass. */
function officeFiles() {
  const code = "import base64,io,docx,openpyxl;d=docx.Document();d.add_paragraph('Notes');a=io.BytesIO();d.save(a);w=openpyxl.Workbook();w.active['A1']='Notes';b=io.BytesIO();w.save(b);print(base64.b64encode(a.getvalue()).decode()+'|'+base64.b64encode(b.getvalue()).decode())";
  const out = execSync(`uv run python -c "${code}"`, { cwd: path.join(__dirname, "..", "..", "backend"), encoding: "utf8", timeout: 60_000 });
  const [docx, xlsx] = out.trim().split("|");
  return { docx: Buffer.from(docx, "base64"), xlsx: Buffer.from(xlsx, "base64") };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The chip an attached file shows above the box: its name and size. */
function chip(page: Page, name: string) {
  return page.getByText(new RegExp(`${name.replace(/\./g, "\\.")} · \\d+(\\.\\d)? (KB|MB)`));
}

test.beforeEach(async ({ page, signIn }) => {
  await signIn("Liam");
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
});

test("S03.01 Sig greets and offers a free-text box, no form first", async ({ page }) => {
  await expect(
    page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant. Spotted something?"),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toBeVisible();
  await expect(page.getByLabel(/What happened, or what would you like/)).toHaveCount(0);
});

test("S03.02 hi gets a polite nudge to give feedback and creates nothing", async ({ page }) => {
  const before = (await getJson<unknown[]>(page, "/my/feedback")).length;
  await chatSay(page, "hi");
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  expect((await getJson<unknown[]>(page, "/my/feedback")).length).toBe(before);
});

test("S03.03 an off-topic question is redirected, pointing to RAKE for policy questions", async ({ page }) => {
  await chatSay(page, "What's the weather like tomorrow?");
  await expect(page.getByText("RAKE is your best bet")).toBeVisible();
});

test("S03.04 a bug with a known tool asks how much it affects work, with three chips that fit a fault", async ({ page }) => {
  await chatSay(page, BUG);
  await expect(page.getByText("How much is this affecting your work")).toBeVisible();
  for (const label of ["Can't work at all", "Slower, but I get there", "Minor, I can live with it"]) {
    await expect(page.getByRole("listitem", { name: "Quick answers" }).getByRole("button", { name: label })).toBeVisible();
  }
});

test("S03.05 clicking Slower, but I get there sends it as the reply, then Sig asks what was expected", async ({ page }) => {
  await chatSay(page, BUG);
  await page.getByRole("button", { name: "Slower, but I get there" }).click();
  await expect(page.getByText("It slows me down, but I get there")).toBeVisible();
  // The stub always asks next; the checklist also allows going straight to the summary.
  await expect(page.getByText("What did you expect to happen, and what happened instead?")).toBeVisible();
});

test("S03.06 the expected-versus-actual reply leads to one short line and the Your feedback card", async ({ page }) => {
  await chatSay(page, BUG);
  await page.getByRole("button", { name: "Slower, but I get there" }).click();
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, "I expected my certificate to open but got a blank screen");
  const lead = page.getByText("Here's what I'll send. Check it and press Confirm, or tell me what to change.");
  await expect(lead).toBeVisible();
  await expect(page.getByRole("region", { name: "Your feedback" })).toBeVisible();
  // The lead-in does not repeat the card's fields.
  await expect(lead).not.toContainText(/Title|Summary|Priority/);
  // Sig asked three questions or fewer: impact and expected-versus-actual, and not which tool.
  await expect(page.getByText(/How much is this affecting|What did you expect to happen/)).toHaveCount(2);
  await expect(page.getByText("Which tool is this about?")).toHaveCount(0);
});

test("S03.07 an unclear tool asks Which tool? with a chip for every project plus Not sure", async ({ page }) => {
  const start = await postJson<{ projects: unknown[] }>(page, "/chat/sessions", { project_slug: null, context: {} });
  await chatSay(page, "The export button is broken and it's annoying");
  await expect(page.getByText("Which tool is this about?")).toBeVisible();
  const chips = page.getByRole("listitem", { name: "Quick answers" }).getByRole("button");
  await expect(chips.last()).toHaveText(/Not sure/);
  await expect(chips).toHaveCount(start.projects.length + 1);
});

test("S03.08 Enter sends and Shift+Enter adds a new line", async ({ page }) => {
  const box = page.getByLabel("Your message");
  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.pressSequentially("line two");
  await expect(box).toHaveValue("line one\nline two");
  // Typing alone sends nothing: no message holds the text yet (the box's own text is not a message).
  const sent = page.getByRole("listitem").filter({ hasText: /line one/ });
  await expect(sent).toHaveCount(0);
  await box.press("Enter");
  await expect(sent).toHaveText(/line one\s+line two/);
  await expect(box).toHaveValue("");
  await expect(page.getByText("Sig is writing…")).toHaveCount(0, { timeout: 20_000 });
});

test("S03.09 a PNG shows as a thumbnail and a PDF, Word and Excel file as a chip with size; each can be removed and shows on the message", async ({ page }) => {
  const { docx, xlsx } = officeFiles();
  const sheet = { name: "sheet.xlsx", mimeType: XLSX, buffer: xlsx };
  await page.locator("#chat-files").setInputFiles([
    { name: "screenshot.png", mimeType: "image/png", buffer: PNG },
    pdf("report.pdf"),
    { name: "notes.docx", mimeType: DOCX, buffer: docx },
    sheet,
  ]);
  await expect(page.getByRole("img", { name: "screenshot.png" })).toBeVisible();
  for (const name of ["report.pdf", "notes.docx", "sheet.xlsx"]) await expect(chip(page, name)).toBeVisible();

  // The cross removes one; it can be attached again.
  await page.getByRole("button", { name: "Don't send sheet.xlsx" }).click();
  await expect(chip(page, "sheet.xlsx")).toHaveCount(0);
  await page.locator("#chat-files").setInputFiles(sheet);
  await expect(chip(page, "sheet.xlsx")).toBeVisible();

  // After sending, the files show on the message and the chips are gone.
  await chatSay(page, "hi");
  await expect(page.getByRole("button", { name: /Don't send/ })).toHaveCount(0);
  const message = page.getByRole("listitem").filter({ hasText: "You: hi" });
  await expect(message.getByRole("img", { name: "screenshot.png" })).toBeVisible();
  for (const name of ["report.pdf", "notes.docx", "sheet.xlsx"]) await expect(message.getByText(name)).toBeVisible();
});

test("S03.10 dragging a macro file shows the drop zone, and dropping it is refused", async ({ page }) => {
  await dropOnChat(page, [MACRO], true);
  await expect(page.getByText(/Drop files to attach/)).toBeVisible();
  await dropOnChat(page, [MACRO]);
  await expect(page.getByText("Macro-enabled Office files can't be uploaded.")).toBeVisible();
  await expect(page.getByText(/Drop files to attach/)).toHaveCount(0);
  await expect(page.getByText(/macro-test\.docm · /)).toHaveCount(0);
});

test("S03.11 dropping a normal PDF attaches it like the paperclip, with a removable chip", async ({ page }) => {
  await dropOnChat(page, [pdf("dropped.pdf")]);
  await expect(chip(page, "dropped.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Don't send dropped.pdf" }).click();
  await expect(chip(page, "dropped.pdf")).toHaveCount(0);
});

test("S03.12 a text file renamed .png is refused because its contents don't match", async ({ page }) => {
  await page.locator("#chat-files").setInputFiles({ name: "not-really-a-picture.png", mimeType: "image/png", buffer: Buffer.from("just some words") });
  await expect(page.getByText(/not-really-a-picture\.png: .*contents don't match/)).toBeVisible();
  await expect(chip(page, "not-really-a-picture.png")).toHaveCount(0);
});

test("S03.13 a file over 10 MB is refused straight away, with no upload", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (r) => r.url().includes("/attachments") && uploads.push(r.url()));
  await page.locator("#chat-files").setInputFiles({ name: "too-big-11MB.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(11 * 1024 * 1024, 32) });
  await expect(page.getByText(/too-big-11MB\.pdf: Files can be up to 10 MB\./)).toBeVisible();
  expect(uploads).toHaveLength(0);
});

test("S03.14 five files disable the paperclip, and a sixth in a later message is refused", async ({ page }) => {
  for (let i = 1; i <= 5; i++) {
    await page.locator("#chat-files").setInputFiles(pdf(`small-${i}.pdf`));
    await expect(chip(page, `small-${i}.pdf`)).toBeVisible();
  }
  const paperclip = page.getByRole("button", { name: /Attach a file/ });
  await expect(paperclip).toBeDisabled();

  // The five go with this message; the API still counts them against the chat.
  await chatSay(page, "hi");
  await expect(paperclip).toBeEnabled();
  await page.locator("#chat-files").setInputFiles(pdf("small-6.pdf"));
  await expect(page.getByText(/small-6\.pdf: Up to 5 files per feedback\./)).toBeVisible();
  await expect(chip(page, "small-6.pdf")).toHaveCount(0);
});

test("S03.15 an item raised from an intranet link carries device, browser, screen, source and time", async ({ page, team }) => {
  await page.goto("/chat?project=it-asset&from=https://intranet.example/assets");
  await expect(page.getByText("About IT Asset")).toBeVisible();
  await chatSay(page, "The asset list is broken and it is blocking my work");
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await chatSay(page, "I expected the list to load but got an error");
  await page.getByRole("button", { name: "Confirm" }).click();
  const heading = page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  const ref = (await heading.innerText()).match(/FB-\d{4}/)![0];

  const darlene = await team.as("Darlene");
  await darlene.goto(`/console?item=${ref}`);
  const context = darlene.getByRole("dialog").locator("dt", { hasText: "Context" }).locator("xpath=following-sibling::dd[1]");
  await expect(context).toHaveText(/Desktop · \w+ on .+ · \d+x\d+ · https:\/\/intranet\.example\/assets · \S+/);
});

test("S03.16 pressing F5 mid-chat keeps the conversation, and New chat starts a fresh one", async ({ page }) => {
  await chatSay(page, "hi");
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  await page.reload();
  await expect(page.getByText("You: hi")).toBeVisible();
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await expect(page.getByText("You: hi")).toHaveCount(0);
});

test("S03.17 thirteen messages without confirming switch to the backup form with the text kept", async ({ page }) => {
  // Thirteen round trips to the stub, one after another.
  test.setTimeout(150_000);
  await reachBackupForm(page);
  await expect(page.locator("strong", { hasText: "Sorry, this is taking longer than it should." })).toBeVisible();
  await expect(page.getByText("What you typed is kept below.")).toBeVisible();
  await expect(page.getByLabel(/What happened, or what would you like/)).toHaveValue(/typed note number 1/);
});

test("S03.18 The Gemini and privacy line sits under the chat box and under the backup form's Send feedback; no other staff page has a footer", async ({ page }) => {
  // Thirteen round trips to the stub to reach the backup form.
  test.setTimeout(150_000);
  const line = (where: Page) => where.getByText(/chats are processed by Google's Gemini model\. Passwords, card numbers and tax file numbers are removed before anything is saved\./);
  const below = async (upper: Locator, lower: Locator) => {
    const [a, b] = [(await upper.boundingBox())!, (await lower.boundingBox())!];
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  };

  await below(page.getByLabel("Your message"), line(page));
  await reachBackupForm(page);
  await below(page.getByRole("button", { name: "Send feedback" }), line(page));

  for (const [path, heading] of [["/", "What can we help you with?"], ["/my", "My feedback"], ["/whats-new", "Fixes and updates"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(line(page)).toHaveCount(0);
  }
});

test("S03.19 With no tool named, the tool chips show the tools you've reported on before first, under 'Your usual tools'", async ({ page, signIn }) => {
  await signIn("Rafael");
  await raiseBug(page, "rake-agent", "RAKE Agent shows a blank answer when I ask about rosters");
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await chatSay(page, "The export button is broken");
  const chips = page.getByRole("listitem", { name: "Quick answers" });
  await expect(chips.getByRole("button").first()).toHaveText("RAKE Agent");
  await expect(chips.getByText("Your usual tools", { exact: true }).locator("..").getByRole("button")).toHaveText(["RAKE Agent"]);
  await expect(chips.getByRole("button").last()).toHaveText("Not sure");
});

test("S03.20 'My app is slow' gets the tool chips under the tool question and never an impact question", async ({ page, signIn }) => {
  await signIn("Aisha");
  await page.goto("/chat");
  await chatSay(page, "My app is slow");
  await expect(page.getByText("Which tool is this about?")).toBeVisible();
  const chips = page.getByRole("listitem", { name: "Quick answers" });
  await expect(chips.getByRole("button").last()).toHaveText("Not sure");
  await expect(chips.getByRole("button", { name: "Slower, but I get there" })).toHaveCount(0);
  await chips.getByRole("button", { name: "AFSS Portal" }).click();
  const summary = page.getByRole("region", { name: "Your feedback" });
  await expect(summary).toContainText("Major");
  await expect(page.getByText("How much is this affecting your work?")).toHaveCount(0);
});

test("S03.21 A question about Sig gets a short answer, with no chips and no card", async ({ page, signIn }) => {
  await signIn("Aisha");
  await page.goto("/chat");
  await chatSay(page, "what is your role");
  const answer = page.getByText("I'm Sig. I pass what you tell me about our intranet tools to the Digital team");
  await expect(answer).toBeVisible();
  await chatSay(page, "why do we need you when we already have rake rgent");
  await expect(answer).toHaveCount(2);
  await expect(page.getByRole("listitem", { name: "Quick answers" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your feedback" })).toHaveCount(0);
});

test("S03.22 'Something else' after the impact chips puts the cursor in the message box and sends nothing", async ({ page }) => {
  await chatSay(page, BUG);
  const chips = page.getByRole("listitem", { name: "Quick answers" });
  await chips.getByRole("button", { name: "Something else" }).click();
  await expect(page.getByLabel("Your message")).toBeFocused();
  // Nothing was sent: the only message from the person is still the bug they typed.
  await expect(page.getByText("Something else", { exact: true })).toHaveCount(1);
  await expect(chips).toBeVisible();
});

// D99: a new chat opens with the app cards. D95: screenshots by paste and, on phones, the camera.

const cards = (page: Page) => page.getByRole("region", { name: /Which tool is it about/ });
const you = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: `You: ${text}` });

test("S03.23 A new chat shows the app cards under Sig's greeting: your usual tools, then Platforms, Agents and Other, then Something else", async ({ page, signIn }) => {
  await signIn("Mei");
  await raiseBug(page, "flipbook", "Flipbook shows a blank page when I open the safety brochure");
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  const groups = cards(page).getByRole("group");
  await expect(groups.first()).toBeVisible();
  expect(await groups.evaluateAll((all) => all.map((g) => g.getAttribute("aria-label")))).toEqual(["Your usual tools", "Platforms", "Agents", "Other"]);
  await expect(cards(page).getByRole("group", { name: "Your usual tools" }).getByRole("button")).toHaveText(["Flipbook"]);
  await expect(cards(page).getByRole("group", { name: "Platforms" }).getByRole("button", { name: "Flipbook" })).toHaveCount(0);
  const projects = await getJson<unknown[]>(page, "/projects");
  await expect(cards(page).getByRole("button")).toHaveCount(projects.length + 1);
  await expect(cards(page).getByRole("button").last()).toHaveText("Something else");
  await expect(page.getByLabel("Your message")).toBeEditable();
});

test("S03.24 Picking a card sends the tool's name, and Sig asks what's happening, never which tool", async ({ page }) => {
  await cards(page).getByRole("button", { name: "IT Asset" }).click();
  await expect(you(page, "IT Asset")).toBeVisible();
  await expect(page.getByText("What's happening with IT Asset?")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText("About IT Asset")).toBeVisible();
  await chatSay(page, "Asset search shows an error every time and it's blocking my work");
  await expect(page.getByText("What did you expect to happen")).toBeVisible();
  await expect(page.getByText("Which tool is this about?")).toHaveCount(0);
});

test("S03.25 Typing first works as before: the cards stay through a chat and go once the tool is named", async ({ page }) => {
  await chatSay(page, "hi");
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  await expect(cards(page)).toBeVisible();
  await chatSay(page, BUG);
  await expect(page.getByText("How much is this affecting your work")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText("About Training Portal")).toBeVisible();
});

test("S03.26 A chat opened for a tool with ?project= shows no cards", async ({ page }) => {
  await page.goto("/chat?project=it-asset");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();
  await expect(page.getByText("About IT Asset")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test("S03.27 Something else puts the cursor in the box and sends nothing", async ({ page }) => {
  await cards(page).getByRole("button", { name: "Something else" }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByLabel("Your message")).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: "You:" })).toHaveCount(0);
});

test("S03.28 A pasted screenshot shows as a thumbnail with the passwords line, then on the message and the summary card; no camera button on a desktop", async ({ page }) => {
  const box = page.getByLabel("Your message");
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeHidden();
  // Copied text that also carries a picture (cells from Excel) pastes as text, not a file.
  await pasteImage(box, "Asset tag 1234");
  await pasteImage(box);
  const shot = page.getByRole("img", { name: /^Screenshot \d\d\.\d\d\.\d\d\.png$/ });
  await expect(shot).toHaveCount(1);
  await expect(page.getByText("Check it doesn't show passwords or card numbers.")).toBeVisible();
  await chatSay(page, BUG);
  await expect(page.getByText("Check it doesn't show passwords or card numbers.")).toHaveCount(0);
  await expect(you(page, BUG).getByRole("img", { name: /^Screenshot / })).toBeVisible();
  await page.getByRole("button", { name: "Slower, but I get there" }).click();
  await chatSay(page, "I expected my certificate to open but got a blank screen");
  await expect(page.getByRole("region", { name: "Your feedback" }).getByRole("img", { name: /^Screenshot / })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("S03.29 Take a photo opens the camera and the photo attaches as a thumbnail", async ({ page }) => {
    const button = page.getByRole("button", { name: "Take a photo" });
    await expect(button).toBeVisible();
    const camera = page.getByTestId("photo-input");
    await expect(camera).toHaveAttribute("capture", "environment");
    const chooser = page.waitForEvent("filechooser");
    await button.click();
    await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();
    await expect(page.getByText("Check it doesn't show passwords or card numbers.")).toBeVisible();
  });
});
