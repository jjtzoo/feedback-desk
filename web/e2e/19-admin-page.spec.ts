import type { Locator, Page } from "@playwright/test";

import { expect, resetDatabase, test } from "./fixtures";
import { answerUntilCard, chatSay, getJson, postJson, raiseBug } from "./helpers";

// Manual checklist section 19 (Admin: projects, Digital Staff, routing rules). The page is checked
// through the screen; people who raise feedback and the items that give "open items" a number are
// set up through the API. Chris is the Admin who works the page; his window is `team.as("Chris")`.

test.beforeAll(resetDatabase);

type Staff = {
  id: string;
  name: string;
  google_email: string;
  role: "digital" | "admin";
  is_away: boolean;
  is_triage_lead: boolean;
  active: boolean;
  open_items: number;
};
type ProjectRow = { id: string; slug: string; name: string; owner_id: string | null; active: boolean };
type Rule = { id: string; category: string | null; priority_order: number };

// The seed has one routing rule: access requests go to Chris. Anything else is a test's own.
const isSeedRule = (r: Rule) => r.category === "access_request";

// Whatever a test changes is put back, so a failing test does not skew the ones after it.
test.afterEach(async ({ team }) => {
  const chris = await team.as("Chris");
  for (const r of await getJson<Rule[]>(chris, "/admin/routing-rules")) {
    if (!isSeedRule(r)) await chris.request.delete(`/api/admin/routing-rules/${r.id}`);
  }
  for (const s of await getJson<Staff[]>(chris, "/admin/digital-staff")) {
    if (s.is_away) await chris.request.patch(`/api/admin/digital-staff/${s.id}`, { data: { is_away: false } });
  }
});

const dialog = (page: Page) => page.getByRole("dialog");
const card = (page: Page) => page.getByRole("region", { name: "Your feedback" });
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });

async function openAdmin(page: Page) {
  await page.goto("/console/admin");
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
}

/** A row of the table on screen, found by the exact text of one of its cells (a name). */
const rowWith = (page: Page, text: string) => page.getByRole("row").filter({ has: page.getByText(text, { exact: true }) });

/** Open a select and pick one of its options. */
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** A console inbox in Cards view, which lists every stage, so an item shows wherever it is. */
async function inboxCards(page: Page, inbox: string) {
  await page.goto(`/console?inbox=${inbox}`);
  await page.getByRole("radio", { name: "Cards", exact: true }).click();
}

async function openChat(page: Page) {
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig.")).toBeVisible();
}

/** Describe it in the chat and answer Sig's questions until the confirm card shows. */
async function reachCard(page: Page, description: string) {
  await openChat(page);
  await chatSay(page, description);
  await answerUntilCard(page);
  await expect(card(page)).toBeVisible();
}

/** Press Confirm and return the reference from "Sent. Your reference is FB-nnnn". */
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Confirm" }).click();
  const heading = page.getByRole("heading", { name: /Sent\. Your reference is FB-\d{4}/ });
  await expect(heading).toBeVisible();
  return (await heading.innerText()).match(/FB-\d{4}/)![0];
}

/** Test Tool as the checklist builds it (S19.04), made through the API when that test has not run. */
async function ensureTestTool(admin: Page, active = true) {
  const staff = await getJson<Staff[]>(admin, "/admin/digital-staff");
  const projects = await getJson<ProjectRow[]>(admin, "/admin/projects");
  const found = projects.find((p) => p.slug === "test-tool");
  if (!found) {
    const mario = staff.find((s) => s.name === "Mario")!;
    await postJson(admin, "/admin/projects", {
      slug: "test-tool",
      name: "Test Tool",
      project_group: "platforms",
      aliases: ["testtool"],
      owner_id: mario.id,
    });
  } else if (found.active !== active) {
    await admin.request.patch(`/api/admin/projects/${found.id}`, { data: { active } });
  }
}

/** Add a routing rule through the dialog: any project, one category, one person, one order. */
async function addRule(admin: Page, category: string, assignee: string, order: string) {
  await admin.getByRole("button", { name: "Add rule" }).click();
  const d = dialog(admin);
  await expect(d.getByRole("heading", { name: "Add a routing rule" })).toBeVisible();
  const boxes = d.getByRole("combobox");
  await choose(admin, boxes.nth(1), category);
  await choose(admin, boxes.nth(2), assignee);
  await d.getByLabel("Order (lower runs first)").fill(order);
  await d.getByRole("button", { name: "Add rule" }).click();
  await expect(d).toHaveCount(0);
}

test("S19.01 A Digital Staff member sees the page read only: no add or edit buttons, toggles disabled", async ({ page, signIn }) => {
  await signIn("Darlene");
  await openAdmin(page);
  await expect(page.getByText("Read only. Only Admins can change these.")).toBeVisible();
  await expect(page.getByText("Changes take effect straight away.")).toHaveCount(0);

  // Projects: the list is there, with no Add project and no Edit buttons.
  await expect(tab(page, /^Projects \(15\)$/)).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(16);
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);

  // Digital Staff: every role picker and toggle is there and disabled.
  await tab(page, /^Digital Staff/).click();
  await expect(page.getByRole("button", { name: "Add person" })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(15);
  for (const toggle of await page.getByRole("switch").all()) await expect(toggle).toBeDisabled();
  await expect(page.getByRole("combobox")).toHaveCount(5);
  for (const picker of await page.getByRole("combobox").all()) await expect(picker).toBeDisabled();

  // Routing rules: the rule is listed, with no Add rule and no Delete.
  await tab(page, /^Routing rules/).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Add rule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete rule" })).toHaveCount(0);
});

test("S19.02 An Admin sees the tabs Projects (15), Digital Staff (5) and Routing rules (1)", async ({ page, signIn }) => {
  await signIn("Chris");
  await openAdmin(page);
  await expect(page.getByText("Changes take effect straight away.")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["Projects (15)", "Digital Staff (5)", "Routing rules (1)"]);
  await expect(page.getByRole("button", { name: "Add project" })).toBeVisible();
  await tab(page, /^Digital Staff/).click();
  await expect(page.getByRole("button", { name: "Add person" })).toBeVisible();
  await tab(page, /^Routing rules/).click();
  await expect(page.getByRole("button", { name: "Add rule" })).toBeVisible();
});

test("S19.03 Editing a project changes name, group, owner, description, aliases, keywords and Active; the short name is locked", async ({
  page,
  signIn,
}) => {
  await signIn("Chris");
  await openAdmin(page);
  await page.getByRole("button", { name: "Edit Flipbook" }).click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Edit Flipbook" })).toBeVisible();

  const slug = d.getByLabel("Short name (for links)");
  await expect(slug).toBeDisabled();
  await expect(slug).toHaveValue("flipbook");

  await d.getByLabel("Name", { exact: true }).fill("Flipbook Viewer");
  await choose(page, d.getByRole("combobox").nth(0), "Other");
  await choose(page, d.getByRole("combobox").nth(1), "Mario");
  await d.getByLabel("Description").fill("Turns pages of brochures on screen.");
  await d.getByLabel("Aliases (comma-separated)").fill("flip, pageturner");
  await d.getByLabel("Keywords (comma-separated)").fill("brochures, pages");
  await d.getByRole("switch", { name: /Active/ }).click();
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d).toHaveCount(0);

  // The table shows every change, and still after a reload; the short name is unchanged.
  const shown = async () => {
    const row = rowWith(page, "Flipbook Viewer");
    await expect(row).toBeVisible();
    const cells = row.getByRole("cell");
    await expect(cells.nth(0)).toContainText("flipbook");
    await expect(cells.nth(1)).toHaveText("Other");
    await expect(cells.nth(2)).toHaveText("Mario");
    await expect(cells.nth(3)).toContainText("flip, pageturner, brochures, pages");
    await expect(cells.nth(4)).toHaveText("No");
  };
  await shown();
  await page.reload();
  await shown();
  await page.getByRole("button", { name: "Edit Flipbook Viewer" }).click();
  await expect(d.getByLabel("Description")).toHaveValue("Turns pages of brochures on screen.");
});

test("S19.04 A project added as Test Tool (short name test-tool, alias testtool, owner Mario) is recognised and sent to Mario with no restart", async ({
  page,
  signIn,
  team,
}) => {
  const chris = await team.as("Chris");
  await openAdmin(chris);
  await chris.getByRole("button", { name: "Add project" }).click();
  const d = dialog(chris);
  await expect(d.getByRole("heading", { name: "Add a project" })).toBeVisible();
  await d.getByLabel("Name", { exact: true }).fill("Test Tool");
  await d.getByLabel("Short name (for links)").fill("test-tool");
  await d.getByLabel("Aliases (comma-separated)").fill("testtool");
  await choose(chris, d.getByRole("combobox").nth(1), "Mario");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d).toHaveCount(0);
  const row = rowWith(chris, "Test Tool");
  await expect(row.getByRole("cell").nth(2)).toHaveText("Mario");
  await expect(row.getByRole("cell").nth(3)).toHaveText("testtool");

  // The agent picks it up at once: no restart between adding it and chatting about it.
  await signIn("Liam");
  await reachCard(page, "testtool is broken");
  await expect(card(page).locator('dt:text-is("Tool") + dd')).toHaveText("Test Tool");
  await confirm(page);
  await expect(page.getByText(/It's with Mario/)).toBeVisible();
});

test("S19.05 Setting Test Tool inactive removes it from the landing page and the chat chips", async ({ page, signIn, team }) => {
  const chris = await team.as("Chris");
  await ensureTestTool(chris);
  await signIn("Tom");

  const tools = page.getByRole("combobox", { name: "Already know which tool?" });
  const option = (name: string) => page.getByRole("option", { name, exact: true });
  await page.goto("/");
  await tools.click();
  await expect(option("RAKE Agent")).toBeVisible();
  await expect(option("Test Tool")).toBeVisible();
  await page.keyboard.press("Escape");

  await openAdmin(chris);
  await chris.getByRole("button", { name: "Edit Test Tool" }).click();
  const d = dialog(chris);
  await d.getByRole("switch", { name: /Active/ }).click();
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d).toHaveCount(0);
  await expect(rowWith(chris, "Test Tool").getByRole("cell").nth(4)).toHaveText("No");

  await page.goto("/");
  await tools.click();
  await expect(option("RAKE Agent")).toBeVisible();
  await expect(option("Test Tool")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A message that names no tool makes Sig offer the tools as chips: RAKE Agent is there, Test Tool is not.
  await openChat(page);
  await chatSay(page, "The export button is broken and it's annoying");
  await expect(page.getByText("Which tool is this about?")).toBeVisible();
  const chips = page.getByLabel("Quick answers");
  await expect(chips.getByRole("button", { name: "RAKE Agent", exact: true })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Test Tool", exact: true })).toHaveCount(0);
});

test("S19.06 The Digital Staff tab shows role, Open items, Away, Triage lead and Active for each person", async ({ page, signIn, team }) => {
  // Give Darlene an open item so the Open items column has something to show besides zeros.
  await raiseBug(await team.as("Aisha"), "rake-agent", "RAKE Agent staff tab check shows an error when I open it");
  await signIn("Chris");
  const staff = await getJson<Staff[]>(page, "/admin/digital-staff");
  expect(staff.map((s) => s.name)).toEqual(["Chris", "Darlene", "Marc", "Mario", "Mike"]);
  expect(staff.find((s) => s.name === "Darlene")!.open_items).toBeGreaterThan(0);

  await openAdmin(page);
  await tab(page, /^Digital Staff/).click();
  await expect(page.getByRole("columnheader")).toHaveText(["Name", "Role", "Open items", "Away", "Triage lead", "Active"]);
  await expect(page.getByRole("row")).toHaveCount(6);

  for (const s of staff) {
    const row = rowWith(page, s.name);
    await expect(row, s.name).toContainText(s.google_email);
    await expect(row.getByRole("combobox"), `${s.name} role`).toHaveText(s.role === "admin" ? "Admin" : "Digital Staff");
    await expect(row.getByRole("cell").nth(2), `${s.name} open items`).toHaveText(String(s.open_items));
    await expect(row.getByRole("switch", { name: `is away: ${s.name}` }), `${s.name} away`).toBeChecked({ checked: s.is_away });
    await expect(row.getByRole("switch", { name: `is triage lead: ${s.name}` }), `${s.name} triage lead`).toBeChecked({ checked: s.is_triage_lead });
    await expect(row.getByRole("switch", { name: `active: ${s.name}` }), `${s.name} active`).toBeChecked({ checked: s.active });
  }
  // Marc is the interim triage lead and the only one.
  await expect(page.getByRole("switch", { name: /^is triage lead/, checked: true })).toHaveCount(1);
  await expect(page.getByRole("switch", { name: "is triage lead: Marc" })).toBeChecked();
});

test.describe("routing around people and rules", () => {
  test.describe.configure({ timeout: 120_000 });

  test("S19.07 With Darlene Away, RAKE Agent feedback goes to Needs review, not to Darlene; turning Away off sends it to her again", async ({
    page,
    signIn,
    team,
  }) => {
    // A control item while Darlene is available: it sits in her inbox, so "not there" is read from a loaded list.
    const control = await raiseBug(await team.as("Aisha"), "rake-agent", "RAKE Agent control report shows an error when I open it");

    const chris = await team.as("Chris");
    await openAdmin(chris);
    await tab(chris, /^Digital Staff/).click();
    const away = rowWith(chris, "Darlene").getByRole("switch", { name: "is away: Darlene" });
    await away.click();
    await expect(away).toBeChecked();

    await signIn("Liam");
    await reachCard(page, "The RAKE Agent shows an error when I open a report");
    const ref = await confirm(page);
    await expect(page.getByText(/It's with the Digital team\./)).toBeVisible();

    const marc = await team.as("Marc");
    await inboxCards(marc, "needs_review");
    const row = marc.getByRole("button", { name: new RegExp(ref) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Needs review");

    const darlene = await team.as("Darlene");
    await inboxCards(darlene, "mine");
    await expect(darlene.getByRole("button", { name: new RegExp(control) })).toBeVisible();
    await expect(darlene.getByRole("button", { name: new RegExp(ref) })).toHaveCount(0);

    // Away off: the next RAKE Agent item is hers again.
    await away.click();
    await expect(away).not.toBeChecked();
    const after = await raiseBug(await team.as("Aisha"), "rake-agent", "RAKE Agent back again shows an error when I open it");
    await inboxCards(darlene, "mine");
    await expect(darlene.getByRole("button", { name: new RegExp(after) })).toBeVisible();
  });

  test("S19.08 A person added with a name, email and role is listed and appears in assignee lists", async ({ page, signIn, team }) => {
    await signIn("Chris");
    await openAdmin(page);
    await tab(page, /^Digital Staff/).click();
    await page.getByRole("button", { name: "Add person" }).click();
    const d = dialog(page);
    await expect(d.getByRole("heading", { name: "Add a person" })).toBeVisible();
    await d.getByLabel("Name", { exact: true }).fill("Sam Reid");
    await d.getByLabel("REDADAIR Google email").fill("sam.reid@redadair.example");
    await choose(page, d.getByRole("combobox"), "Admin (approves feedback)");
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await expect(d).toHaveCount(0);

    await expect(tab(page, /^Digital Staff \(6\)$/)).toBeVisible();
    const row = rowWith(page, "Sam Reid");
    await expect(row).toContainText("sam.reid@redadair.example");
    await expect(row.getByRole("combobox")).toHaveText("Admin");

    // The assignee list on an item in the console offers the new person.
    const ref = await raiseBug(await team.as("Grace"), "rake-agent", "RAKE Agent assignee list check shows an error when I open it");
    await page.goto(`/console?item=${ref}`);
    await page.getByRole("combobox", { name: /Assignee/ }).click();
    await expect(page.getByRole("option", { name: "Sam Reid", exact: true })).toBeVisible();
  });

  test("S19.09 A rule for any project, category Usability, assign to Darlene, order 50 sends Training Portal feedback to Darlene, not Marc", async ({
    page,
    signIn,
    team,
  }) => {
    const chris = await team.as("Chris");
    await openAdmin(chris);
    await tab(chris, /^Routing rules/).click();
    await addRule(chris, "Usability", "Darlene", "50");
    await expect(tab(chris, /^Routing rules \(2\)$/)).toBeVisible();
    const rule = chris.getByRole("row").filter({ hasText: "Usability" });
    await expect(rule.getByRole("cell")).toHaveText(["50", "Any project", "Usability", "Darlene", ""]);

    await signIn("Aisha");
    await reachCard(page, "The Training Portal is confusing");
    await confirm(page);
    await expect(page.getByText(/It's with Darlene/)).toBeVisible();
    await expect(page.getByText(/It's with Marc/)).toHaveCount(0);

    await rule.getByRole("button", { name: "Delete rule" }).click();
    await expect(rule).toHaveCount(0);
    await expect(tab(chris, /^Routing rules \(1\)$/)).toBeVisible();
  });

  test("S19.10 Two rules at the same order for Question (Darlene, Mario) send the item to whoever has fewer open items", async ({
    page,
    signIn,
    team,
  }) => {
    // Darlene gets more open items than Mario, so "fewer" (Mario) is not just the first name in the list.
    const chris = await team.as("Chris");
    const counts = async () => {
      const staff = await getJson<Staff[]>(chris, "/admin/digital-staff");
      return { darlene: staff.find((s) => s.name === "Darlene")!.open_items, mario: staff.find((s) => s.name === "Mario")!.open_items };
    };
    for (let n = 1; n <= 6; n++) {
      const now = await counts();
      if (now.darlene > now.mario) break;
      await raiseBug(await team.as("Tom"), "rake-agent", `RAKE Agent open item ${n} shows an error when I open it`);
    }
    const before = await counts();
    expect(before.darlene).toBeGreaterThan(before.mario);

    await openAdmin(chris);
    await tab(chris, /^Routing rules/).click();
    await addRule(chris, "Question", "Darlene", "50");
    await addRule(chris, "Question", "Mario", "50");
    await expect(tab(chris, /^Routing rules \(3\)$/)).toBeVisible();

    await signIn("Mei");
    await reachCard(page, "How do I export from the Training Portal?");
    await confirm(page);
    await expect(page.getByText(/It's with Mario/)).toBeVisible();
    await expect(page.getByText(/It's with Darlene/)).toHaveCount(0);

    const rules = chris.getByRole("row").filter({ hasText: "Question" });
    await expect(rules).toHaveCount(2);
    await rules.first().getByRole("button", { name: "Delete rule" }).click();
    await expect(rules).toHaveCount(1);
    await rules.first().getByRole("button", { name: "Delete rule" }).click();
    await expect(rules).toHaveCount(0);
    await expect(tab(chris, /^Routing rules \(1\)$/)).toBeVisible();
  });
});
