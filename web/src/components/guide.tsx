"use client";

import {
  BarChart3,
  Bell,
  CheckCircle2,
  FileText,
  Gavel,
  Hash,
  HelpCircle,
  KanbanSquare,
  LayoutDashboard,
  MapPin,
  Megaphone,
  MessageSquareText,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Me } from "@/lib/api";
import { cn } from "@/lib/utils";

type Area = "staff" | "console";
type Step = { icon: typeof Bell; title: string; body: string; roles?: Me["role"][] };

const STEPS: Record<Area, Step[]> = {
  staff: [
    {
      icon: MessageSquareText,
      title: "Welcome to Feedback",
      body: "Report a problem, ask for access or suggest an idea for any intranet platform or agent. This short guide shows you around.",
    },
    {
      icon: Sparkles,
      title: "Start a conversation",
      body: "Pick a card on the home page, or select Give feedback. The assistant asks up to three short questions. Attach a screenshot if it helps.",
    },
    {
      icon: CheckCircle2,
      title: "Check, then confirm",
      body: "You'll see a summary of what will be sent. Nothing is sent until you select Confirm, and you can change anything first.",
    },
    {
      icon: MapPin,
      title: "Follow its progress",
      body: "Every item gets a reference such as FB-0137. My feedback shows where each one is up to, who has it and when it's expected. Reply on the tracker to add details.",
    },
    {
      icon: Bell,
      title: "Stay in the loop",
      body: "The bell shows updates on your feedback. What's new lists the changes the team releases each Friday.",
    },
    {
      icon: LayoutDashboard,
      title: "Your console",
      body: "As part of the Digital team, open the console from your account menu to work items, approve requests and see the dashboard.",
      roles: ["digital", "admin"],
    },
  ],
  console: [
    {
      icon: KanbanSquare,
      title: "Work",
      body: "Every item routed to the team, as a board, list or cards. Drag a card to change its status, or open it for the full brief.",
    },
    {
      icon: FileText,
      title: "Inside an item",
      body: "The developer brief, attachments and history. A public update is shown to the person who sent it; an internal note stays with the team.",
    },
    {
      icon: Gavel,
      title: "Approvals",
      body: "New items wait here for an Admin. Approve, decline with a reason, or ask the sender for more information.",
      roles: ["admin"],
    },
    { icon: Hash, title: "Channels", body: "One shared thread per project, for the team to discuss its items." },
    {
      icon: Megaphone,
      title: "Releases",
      body: "Each Friday a release is drafted per project. The owner ticks, edits and publishes it to What's new. Nothing publishes on its own.",
    },
    {
      icon: BarChart3,
      title: "Dashboard",
      body: "Open items, the weekly trend, response times, and AI usage against the daily and monthly budgets.",
    },
    {
      icon: Settings2,
      title: "Admin",
      body: "Projects, Digital Staff and the routing rules that decide who receives each item.",
      roles: ["admin"],
    },
  ],
};

const seenKey = (area: Area) => `feedback-guide-seen:${area}:v1`;

function hasSeen(area: Area): boolean {
  try {
    return window.localStorage.getItem(seenKey(area)) === "1";
  } catch {
    return true; // storage blocked: don't pop the guide on every page
  }
}

function markSeen(area: Area) {
  try {
    window.localStorage.setItem(seenKey(area), "1");
  } catch {
    // storage blocked; the Guide button still works
  }
}

/** The Guide button, and a short step-by-step walkthrough that opens by itself on someone's
 *  first visit to each area. Steps are filtered by role. */
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

  function change(next: boolean) {
    setOpen(next);
    if (next) setIndex(0);
    else markSeen(area);
  }

  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const Icon = step.icon;

  return (
    <>
      <Button
        variant="ghost"
        className={cn("h-11 gap-1.5 rounded-full px-3", tone === "dark" && "text-band-foreground hover:bg-white/10 hover:text-band-foreground")}
        onClick={() => change(true)}
      >
        <HelpCircle className="size-5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Guide</span>
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="gap-0 rounded-3xl p-6 sm:max-w-md">
          <div key={index} className="animate-fade-up">
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-tint text-brand-text" aria-hidden="true">
              <Icon className="size-6" />
            </span>
            <p className="mt-4 text-xs font-semibold text-muted-foreground">
              Step {index + 1} of {steps.length}
            </p>
            <DialogTitle className="mt-1 text-xl font-bold">{step.title}</DialogTitle>
            <DialogDescription className="mt-2 text-base leading-relaxed">{step.body}</DialogDescription>
          </div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex gap-1.5" aria-hidden="true">
              {steps.map((s, i) => (
                <span key={s.title} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30")} />
              ))}
            </div>
            <div className="flex gap-2">
              {index > 0 && (
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => setIndex((i) => i - 1)}>
                  Back
                </Button>
              )}
              <Button className="h-11 rounded-xl px-5" onClick={() => (last ? change(false) : setIndex((i) => i + 1))}>
                {last ? "Done" : "Next"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
