import { expect, resetDatabase, test } from "./fixtures";
import { chatSay, getJson, raise, raiseBug } from "./helpers";

// Manual checklist section 7 (staff: My feedback).

test.beforeAll(resetDatabase);

const PRAISE = "Thanks for the Training Portal update, works great";
// A raised item and a near-copy of it, so the second person is offered "Add my comment there instead".
const FLIPBOOK = "Flipbook pages are blank on the safety brochure, it's annoying";
const FLIPBOOK_AGAIN = "Flipbook pages are blank on the brochure, it's annoying, I expected pages but got white";

test("S07.01 /my lists your items and the ones you follow in Open and Closed groups with counts", async ({ page, signIn, team }) => {
  const mario = await team.as("Mario");
  const followed = await raise(mario, FLIPBOOK, ["I expected pages but got white screens"], "flipbook");

  await signIn("Tom");
  const open = await raiseBug(page, "rake-agent", "RAKE Agent logs me out every ten minutes");
  const closed = await raise(page, PRAISE);

  // Tom follows Mario's item the way a person does: "Add my comment there instead".
  await page.goto("/chat?project=flipbook");
  await chatSay(page, FLIPBOOK_AGAIN);
  const box = page.getByText("Someone may have raised this already", { exact: true }).locator("xpath=ancestor::li[1]");
  await expect(box).toContainText(followed);
  await box.getByRole("button", { name: "Add my comment there instead" }).click();
  await expect(page.getByRole("heading", { name: `Added to ${followed}` })).toBeVisible();

  await page.goto("/my");
  await expect(page.getByRole("heading", { level: 1, name: "My feedback" })).toBeVisible();
  const openGroup = page.getByRole("region", { name: /^Open/ });
  const closedGroup = page.getByRole("region", { name: /^Closed/ });
  await expect(page.getByRole("heading", { level: 2, name: /^Open · 2$/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Closed · 1$/ })).toBeVisible();
  await expect(openGroup.getByRole("link", { name: new RegExp(open) })).toBeVisible();
  await expect(openGroup.getByRole("link", { name: new RegExp(followed) })).toContainText("Following");
  await expect(closedGroup.getByRole("link", { name: new RegExp(closed) })).toBeVisible();
});

test("S07.02 a row shows the reference, title, tool or 'Tool to confirm', a plain status, 'updated … ago' and a stage badge", async ({ page, signIn }) => {
  await signIn("Aisha");
  const title = "RAKE Agent drops my session after ten minutes";
  const ref = await raiseBug(page, "rake-agent", title);
  // "Not sure" to "Which tool?" leaves the item without a tool.
  const unsure = await raise(page, "The export button is broken and it's annoying", ["Not sure", "I expected the export to work but got a blank screen"]);

  await page.goto("/my");
  const row = page.getByRole("link", { name: new RegExp(ref) });
  await expect(row).toContainText(ref);
  await expect(row).toContainText(title);
  await expect(row).toContainText("RAKE Agent");
  await expect(row).toContainText(/waiting for approval/i);
  await expect(row.locator("time")).toHaveText(/^updated (just now|.+ ago)$/);

  const noTool = page.getByRole("link", { name: new RegExp(unsure) });
  await expect(noTool).toContainText("Tool to confirm");
  await expect(noTool).toContainText(/being checked/i);

  // The stage badge on its own: the status line above also starts with "Received", so match the whole badge text.
  await expect(row.getByText("Received", { exact: true })).toBeVisible();
});

test("S07.03 a row opens its tracker and 'My feedback' stays highlighted in the header", async ({ page, signIn }) => {
  await signIn("Rafael");
  const ref = await raiseBug(page, "rake-agent", "RAKE Agent shows an empty list after I search");

  await page.goto("/my");
  await page.getByRole("link", { name: new RegExp(ref) }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${ref}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My feedback" })).toHaveAttribute("aria-current", "page");
});

test("S07.04 someone with no items sees 'No feedback yet'", async ({ page, signIn }) => {
  // Mike is never given an item in this file.
  await signIn("Mike");
  await page.goto("/my");
  await expect(page.getByText(/No feedback yet/)).toBeVisible();
  await expect(page.getByRole("link", { name: /FB-\d{4}/ })).toHaveCount(0);
});

test("S07.05 a staff member sees only their own and followed items", async ({ page, signIn, team }) => {
  // Someone else's item exists and must stay out of Grace's list.
  const others = await raiseBug(await team.as("Aisha"), "rake-agent", "RAKE Agent shows the wrong date on Aisha's report");

  await signIn("Grace");
  const mine = await raiseBug(page, "rake-agent", "RAKE Agent shows the wrong date on my report");

  await page.goto("/my");
  await expect(page.getByRole("link", { name: new RegExp(mine) })).toBeVisible();
  await expect(page.getByRole("link", { name: /FB-\d{4}/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: new RegExp(others) })).toHaveCount(0);
  const list = await getJson<{ reference: string }[]>(page, "/my/feedback");
  expect(list.map((i) => i.reference)).toEqual([mine]);
});
