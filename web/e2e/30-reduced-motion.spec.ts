import { expect, resetDatabase, test } from "./fixtures";
import { chatSay } from "./helpers";

// Manual checklist section 30: reduced motion. Sig's reactions (docs/research/sig-motion-interactions.md)
// turn into face swaps, and no animation runs past 5 seconds (WCAG 2.2.2).

test.beforeAll(resetDatabase);

type Watch = { faces: string[]; long: string[] };

test("S30.02 With reduced motion, Sig's face changes when a message is sent and nothing animates for more than 5 seconds", async ({ page, signIn }) => {
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

  // Each face Sig shows from here on, as state/reaction.
  const sig = page.getByRole("region", { name: /Chat with Sig/ }).locator("header [data-state]");
  await sig.evaluate((el: HTMLElement) => {
    const { faces } = (window as unknown as { sigWatch: Watch }).sigWatch;
    const face = () => `${el.dataset.state}/${el.querySelector("[data-reaction]")?.getAttribute("data-reaction") ?? ""}`;
    new MutationObserver(() => faces.push(face())).observe(el, { attributes: true, subtree: true, attributeFilter: ["data-state", "data-reaction"] });
  });

  await chatSay(page, "hi");
  await expect(page.getByText("I'm here for feedback on our intranet tools")).toBeVisible();
  await expect(sig).toHaveAttribute("data-state", "ready");
  await expect(sig.locator("[data-reaction]")).toHaveCount(0);

  const { faces, long } = await page.evaluate(() => (window as unknown as { sigWatch: Watch }).sigWatch);
  expect(faces).toContain("writing/nod");
  expect(long).toEqual([]);
});
