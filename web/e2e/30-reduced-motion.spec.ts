import { expect, resetDatabase, test } from "./fixtures";
import { chatSay } from "./helpers";

// Manual checklist section 30: reduced motion. Sig's mark still shows its writing face while it works
// (D49), and no animation runs past 5 seconds (WCAG 2.2.2).

test.beforeAll(resetDatabase);

type Watch = { faces: string[]; long: string[] };

test("S30.02 With reduced motion, Sig's mark shows its writing face while it writes and nothing animates for more than 5 seconds", async ({ page, signIn }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Every animation that starts on the page, from the first paint: note any that would run past 5 s.
  await page.addInitScript(() => {
    const watch: Watch = { faces: [], long: [] };
    (window as unknown as { sigWatch: Watch }).sigWatch = watch;
    document.addEventListener(
      "animationstart",
      (e) => {
        const run = (e.target as Element).getAnimations().find((a) => (a as CSSAnimation).animationName === e.animationName);
        const end = Number(run?.effect?.getComputedTiming().endTime ?? Infinity);
        if (end > 5000) watch.long.push(`${e.animationName} (${end} ms)`);
      },
      true,
    );
  });
  await signIn("Liam");
  await page.goto("/chat");
  await expect(page.getByText("G'day, I'm Sig, Smoke Signal's AI assistant.")).toBeVisible();

  // Each face Sig's marks show from here on.
  const chat = page.getByRole("region", { name: /Chat with Sig/ });
  await chat.evaluate((el: HTMLElement) => {
    const { faces } = (window as unknown as { sigWatch: Watch }).sigWatch;
    const record = () => el.querySelectorAll<HTMLElement>("[data-state]").forEach((m) => faces.push(m.dataset.state ?? ""));
    new MutationObserver(record).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
  });

  await chatSay(page, "hi");
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  await expect(chat.locator("[data-state]")).toHaveAttribute("data-state", "ready");

  const { faces, long } = await page.evaluate(() => (window as unknown as { sigWatch: Watch }).sigWatch);
  expect(faces).toContain("writing");
  expect(long).toEqual([]);
});
