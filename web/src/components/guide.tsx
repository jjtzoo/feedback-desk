"use client";

import { HelpCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import type { Me } from "@/lib/api";
import { cn } from "@/lib/utils";

type Area = "staff" | "console";

/** One stop on the tour. `target` is a `data-tour` value on the real control; `path` is the page
 *  the step lives on (the tour goes there first). No target, or a hidden one, centres the card.
 *  With an `action`, the person presses OK, the control is highlighted, and clicking it unlocks the
 *  next step; without one the step is only read and moved past with Next. */
type Step = { title: string; body: string; action?: string; target?: string; path?: string; roles?: Me["role"][] };

const STEPS: Record<Area, Step[]> = {
  staff: [
    {
      title: "Welcome to Smoke Signal",
      body: "Report a problem, ask for access or suggest an idea for any intranet platform or agent. This tour shows you where everything is.",
      path: "/",
    },
    {
      title: "Start here",
      body: "Pick the card that fits. Sig, the assistant, asks up to three short questions, then shows a summary. Nothing is sent until you select Confirm.",
      target: "start-cards",
      path: "/",
    },
    { title: "Give feedback", body: "Opens the assistant from any page.", action: "Click Give feedback", target: "nav-chat" },
    {
      title: "My feedback",
      body: "Everything you've sent, where each one is up to and who has it. Open one to follow it like a parcel, or reply to add details.",
      action: "Click My feedback",
      target: "nav-my",
    },
    {
      title: "Updates",
      body: "The bell shows news on your feedback: approved, started, resolved, or a reply.",
      action: "Click the bell",
      target: "bell",
    },
    { title: "What's new", body: "The changes the team releases each Friday.", action: "Click What's new", target: "nav-whats-new" },
    {
      title: "Your account",
      body: "Your initials, top right, open your account menu: who you're signed in as, and Sign out.",
      action: "Click your initials, top right",
      target: "user-menu",
    },
    {
      title: "Your console",
      body: "As part of the Digital team, this button takes you to the console to work items, approve requests and see the dashboard.",
      target: "nav-console",
      roles: ["digital", "admin"],
    },
    { title: "That's it", body: "Open this tour again any time from Guide.", target: "guide" },
  ],
  console: [
    {
      title: "Work",
      body: "Every item routed to the team, as a board, list or cards. Drag a card to change its status, or open it for the full brief, history and replies.",
      action: "Click Work",
      target: "console-work",
      path: "/console",
    },
    {
      title: "Approvals",
      body: "New items wait here for an Admin. Approve, decline with a reason, or ask the sender for more information.",
      action: "Click Approvals",
      target: "console-approvals",
      roles: ["admin"],
    },
    {
      title: "Channels",
      body: "One shared thread per project, for the team to discuss its items.",
      action: "Click Channels",
      target: "console-channels",
    },
    {
      title: "Releases",
      body: "Each Friday a release is drafted per project. The owner ticks, edits and publishes it to What's new. Nothing publishes on its own.",
      action: "Click Releases",
      target: "console-releases",
    },
    {
      title: "Dashboard",
      body: "Open items, the weekly trend, response times, and AI usage against the budgets.",
      action: "Click Dashboard",
      target: "console-dashboard",
    },
    {
      title: "Admin",
      body: "Projects, Digital Staff and the routing rules that decide who receives each item.",
      action: "Click Admin",
      target: "console-admin",
      roles: ["admin"],
    },
    {
      title: "Smoke Signal home",
      body: "Back to the staff pages, where anyone gives feedback and follows it.",
      target: "nav-home",
    },
    { title: "That's it", body: "Open this tour again any time from Guide.", target: "guide" },
  ],
};

const PAD = 6;
const seenKey = (area: Area) => `feedback-guide-seen:${area}:v2`;

function hasSeen(area: Area): boolean {
  try {
    return window.localStorage.getItem(seenKey(area)) === "1";
  } catch {
    return true; // storage blocked: don't pop the tour on every page
  }
}

function markSeen(area: Area) {
  try {
    window.localStorage.setItem(seenKey(area), "1");
  } catch {
    // storage blocked; the Guide button still works
  }
}

/** The first visible element for a `data-tour` value (the header has desktop and mobile copies). */
function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  return Array.from(all).find((el) => el.getClientRects().length > 0) ?? null;
}

/** The Guide button, and a spotlight tour that highlights each control it describes. It opens
 *  by itself on someone's first visit to each area; Skip tour or Esc ends it. Steps by role. */
export function GuideButton({ area, tone = "light" }: { area: Area; tone?: "light" | "dark" }) {
  const me = useMe();
  const steps = STEPS[area].filter((s) => !s.roles || s.roles.includes(me.role));
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);

  // Moving between the staff area and the console mid-tour unmounts this button: that counts as seen.
  useEffect(() => {
    if (!open) return;
    return () => markSeen(area);
  }, [open, area]);

  useEffect(() => {
    if (hasSeen(area)) return;
    const timer = window.setTimeout(() => setOpen(true), 400);
    return () => window.clearTimeout(timer);
  }, [area]);

  function start() {
    setIndex(0);
    setRun((n) => n + 1); // a fresh Tour, so a "Try it out" in progress does not carry over
    setOpen(true);
  }

  function end() {
    setOpen(false);
    markSeen(area);
  }

  return (
    <>
      <Button
        variant="ghost"
        data-tour="guide"
        className={cn("h-11 gap-1.5 rounded-full px-3", tone === "dark" && "text-band-foreground hover:bg-white/10 hover:text-band-foreground")}
        onClick={start}
      >
        <HelpCircle className="size-5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Guide</span>
      </Button>
      {open && createPortal(<Tour key={run} steps={steps} index={index} onIndex={setIndex} onEnd={end} />, document.body)}
    </>
  );
}

function Tour({ steps, index, onIndex, onEnd }: { steps: Step[]; index: number; onIndex: (i: number) => void; onEnd: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  // "intro": the card explains the step. "act": the control is highlighted and waits for a click.
  // "try": the click worked; the page is free to use until the person presses Next.
  const [phase, setPhase] = useState<"intro" | "act" | "try">("intro");
  const acting = phase === "act" && Boolean(step.action);
  const trying = phase === "try";
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const go = useCallback(
    (i: number) => {
      setPhase("intro");
      onIndex(i);
    },
    [onIndex],
  );

  // Go to the step's page first, so the highlighted control is really there. While trying a
  // feature the person may go anywhere.
  useEffect(() => {
    if (phase === "intro" && step.path && step.path !== path) router.push(step.path);
  }, [phase, step.path, path, router]);

  // Find the control, bring it into view, and follow it on scroll and resize.
  const measure = useCallback(() => {
    const el = findTarget(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.target]);

  useLayoutEffect(() => {
    findTarget(step.target)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const frame = window.requestAnimationFrame(measure);
    // After a route change or a smooth scroll the control moves: measure again shortly.
    const retry = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, step.target, path]);

  useEffect(() => {
    if (phase === "intro") heading.current?.focus();
  }, [index, phase]);

  // Esc ends the tour, except while trying a feature, where Esc belongs to the page (menus, dialogs).
  useEffect(() => {
    if (trying) return;
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onEnd();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onEnd, trying]);

  // While waiting for the click, only the highlighted control works. Pressing it lets the control
  // do its job (open the page or menu) and frees the page to try it; Next moves on.
  useEffect(() => {
    if (!acting) return;
    const where = (e: Event): "card" | "target" | "outside" => {
      const node = e.target instanceof Node ? e.target : null;
      if (node && card.current?.contains(node)) return "card";
      if (node && findTarget(step.target)?.contains(node)) return "target";
      return "outside";
    };
    const onPointerDown = (e: PointerEvent) => {
      const at = where(e);
      if (at === "outside") {
        e.preventDefault();
        e.stopPropagation();
      } else if (at === "target") setPhase("try");
    };
    const onClick = (e: MouseEvent) => {
      const at = where(e);
      if (at === "outside") {
        e.preventDefault();
        e.stopPropagation();
      } else if (at === "target" && e.detail === 0) setPhase("try"); // pressed with the keyboard
    };
    // Keys too: Tab, Shift+Tab and Esc stay free, but Enter, Space and arrows only work on the control or the card.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Escape") return;
      if (where(e) === "outside") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [acting, step.target]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab" && card.current && !acting) {
      // Keep focus inside the tour card.
      const items = card.current.querySelectorAll<HTMLElement>("button");
      const first = items[0];
      const final = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        final.focus();
      } else if (!e.shiftKey && document.activeElement === final) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (trying) {
    return (
      <div className="pointer-events-none fixed inset-0 z-50">
        <div
          role="status"
          className="pointer-events-auto absolute right-4 bottom-4 flex w-[min(22rem,calc(100vw-2rem))] items-center gap-2 rounded-2xl bg-popover p-2 pl-4 text-popover-foreground shadow-card ring-1 ring-foreground/10"
        >
          {/* One row, so it covers as little of the page as possible while the person tries the feature. */}
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-bold">Try it out</span>
            <span className="sr-only">
              Step {index + 1} of {steps.length}. Have a look at {step.title}, then press {last ? "Done" : "Next"} to carry on.
            </span>
            <span aria-hidden="true" className="text-muted-foreground"> · Step {index + 1} of {steps.length}</span>
          </p>
          <div className="flex items-center gap-1">
            {!last && (
              <Button variant="ghost" className="h-11 rounded-xl text-muted-foreground" onClick={onEnd}>
                Skip tour
              </Button>
            )}
            <Button className="h-11 rounded-xl px-5" onClick={() => (last ? onEnd() : go(index + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50" onKeyDown={onKeyDown}>
      {/* Blocks the page while a card is open; while waiting for a click only the control is live. */}
      {!acting && <div className="pointer-events-auto absolute inset-0" aria-hidden="true" />}
      {rect ? (
        <div
          aria-hidden="true"
          className="absolute rounded-xl transition-all duration-200 ease-out"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            // A box-shadow ring (Tailwind's ring utilities are box-shadows too, and an inline one would replace them).
            boxShadow: `0 0 0 ${acting ? "4px var(--primary)" : "2px rgb(255 255 255 / 0.8)"}, 0 0 0 9999px rgb(0 0 0 / 0.55)`,
          }}
        >
          {acting && <span className="absolute -inset-2 rounded-2xl ring-4 ring-primary/60 motion-safe:animate-pulse" />}
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
      )}
      {acting ? (
        <div
          ref={card}
          role="status"
          className="pointer-events-auto absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-popover p-4 text-popover-foreground shadow-card ring-1 ring-foreground/10"
          style={cardPosition(rect)}
        >
          <p className="text-base font-bold">{step.action}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Step {index + 1} of {steps.length}. {rect ? "Click the highlighted control to try it." : "That control isn't showing on this screen."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" className="-ml-2 h-11 rounded-xl text-muted-foreground" onClick={onEnd}>
              Skip tour
            </Button>
            <Button variant="outline" className="ml-auto h-11 rounded-xl" onClick={() => go(index + 1)}>
              Skip this step
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          className="pointer-events-auto absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-popover p-5 text-popover-foreground shadow-card ring-1 ring-foreground/10"
          style={cardPosition(rect)}
        >
          <p className="text-xs font-semibold text-muted-foreground">
            Step {index + 1} of {steps.length}
          </p>
          <h2 id="tour-title" ref={heading} tabIndex={-1} className="mt-1 text-lg font-bold outline-none">
            {step.title}
          </h2>
          <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          <div className="mt-5 flex items-center gap-2">
            {!last && (
              <Button variant="ghost" className="-ml-2 h-11 rounded-xl text-muted-foreground" onClick={onEnd}>
                Skip tour
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              {index > 0 && (
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => go(index - 1)}>
                  Back
                </Button>
              )}
              <Button
                className="h-11 rounded-xl px-5"
                onClick={() => {
                  if (last) onEnd();
                  else if (step.action) setPhase("act");
                  else go(index + 1);
                }}
              >
                {last ? "Done" : step.action ? "OK" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Below the control if it fits, otherwise above; centred when there is no control to point at. */
function cardPosition(rect: DOMRect | null): CSSProperties {
  if (!rect) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const width = Math.min(352, window.innerWidth - 32);
  const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
  const below = rect.bottom + PAD + 12;
  if (window.innerHeight - below > 220) return { left, top: below };
  return { left, bottom: window.innerHeight - rect.top + PAD + 12 };
}
