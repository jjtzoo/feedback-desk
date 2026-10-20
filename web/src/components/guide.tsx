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
 *  the step lives on (the tour goes there first). No target, or a hidden one, centres the card. */
type Step = { title: string; body: string; target?: string; path?: string; roles?: Me["role"][] };

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
    { title: "Give feedback", body: "Opens the assistant from any page.", target: "nav-chat" },
    {
      title: "My feedback",
      body: "Everything you've sent, where each one is up to and who has it. Open one to follow it like a parcel, or reply to add details.",
      target: "nav-my",
    },
    { title: "Updates", body: "The bell shows news on your feedback: approved, started, resolved, or a reply.", target: "bell" },
    { title: "What's new", body: "The changes the team releases each Friday.", target: "nav-whats-new" },
    {
      title: "Your console",
      body: "As part of the Digital team, open the console from this menu to work items, approve requests and see the dashboard.",
      target: "user-menu",
      roles: ["digital", "admin"],
    },
    { title: "That's it", body: "Open this tour again any time from Guide.", target: "guide" },
  ],
  console: [
    {
      title: "Work",
      body: "Every item routed to the team, as a board, list or cards. Drag a card to change its status, or open it for the full brief, history and replies.",
      target: "console-work",
      path: "/console",
    },
    {
      title: "Approvals",
      body: "New items wait here for an Admin. Approve, decline with a reason, or ask the sender for more information.",
      target: "console-approvals",
      roles: ["admin"],
    },
    { title: "Channels", body: "One shared thread per project, for the team to discuss its items.", target: "console-channels" },
    {
      title: "Releases",
      body: "Each Friday a release is drafted per project. The owner ticks, edits and publishes it to What's new. Nothing publishes on its own.",
      target: "console-releases",
    },
    { title: "Dashboard", body: "Open items, the weekly trend, response times, and AI usage against the budgets.", target: "console-dashboard" },
    {
      title: "Admin",
      body: "Projects, Digital Staff and the routing rules that decide who receives each item.",
      target: "console-admin",
      roles: ["admin"],
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

  useEffect(() => {
    if (hasSeen(area)) return;
    const timer = window.setTimeout(() => setOpen(true), 400);
    return () => window.clearTimeout(timer);
  }, [area]);

  function start() {
    setIndex(0);
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
      {open && createPortal(<Tour steps={steps} index={index} onIndex={setIndex} onEnd={end} />, document.body)}
    </>
  );
}

function Tour({ steps, index, onIndex, onEnd }: { steps: Step[]; index: number; onIndex: (i: number) => void; onEnd: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Go to the step's page first, so the highlighted control is really there.
  useEffect(() => {
    if (step.path && step.path !== path) router.push(step.path);
  }, [step.path, path, router]);

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
    heading.current?.focus();
  }, [index]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onEnd();
    } else if (e.key === "Tab" && card.current) {
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

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      {/* Blocks the page while the tour is open; the hole in the dim layer shows the control. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/80 transition-all duration-200 ease-out"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-popover p-5 text-popover-foreground shadow-card ring-1 ring-foreground/10"
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
              <Button variant="outline" className="h-11 rounded-xl" onClick={() => onIndex(index - 1)}>
                Back
              </Button>
            )}
            <Button className="h-11 rounded-xl px-5" onClick={() => (last ? onEnd() : onIndex(index + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
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
