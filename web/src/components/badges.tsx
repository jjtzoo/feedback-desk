import { CheckCircle2, CircleDot, Clock3, Copy, Hammer, Minus, OctagonAlert, ThumbsUp, TriangleAlert, XCircle } from "lucide-react";

import type { Ending, Priority, Stage, Status, WorkType } from "@/lib/api";
import { ENDING_LABEL, PRIORITY_LABEL, PRIORITY_WORD, STAGE_LABEL, STATUS_LABEL, WORK_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

// Every badge pairs a word with an icon, so status never relies on colour (fire-services-ui).

const base = "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

/** Staff see the word ("Major"); the console passes `showCode` for "P2 · Major". Once the item is resolved or
 *  ended, `quiet` turns it neutral grey with its icon and words kept, so the status leads (D83). */
export function PriorityBadge({ priority, showCode = false, quiet = false, className }: { priority: Priority | null; showCode?: boolean; quiet?: boolean; className?: string }) {
  if (!priority) return null;
  const styles: Record<Priority, string> = {
    P1: "border-[1.5px] border-primary bg-brand-tint text-brand-text",
    P2: "bg-warning-tint text-warning",
    P3: "bg-secondary text-secondary-foreground",
    P4: "bg-secondary text-muted-foreground",
  };
  const Icon = priority === "P1" ? OctagonAlert : priority === "P2" ? TriangleAlert : Minus;
  return (
    <span className={cn(base, quiet ? "bg-secondary text-muted-foreground" : styles[priority], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {showCode ? PRIORITY_LABEL[priority] : PRIORITY_WORD[priority]}
    </span>
  );
}

// One tone per status, used wherever a status is shown (list, cards, panel, approvals).
const STATUS_TONE: Record<Status, string> = {
  new: "border border-border text-foreground",
  needs_review: "bg-waiting-tint text-waiting",
  awaiting_approval: "bg-warning-tint text-warning",
  approved: "bg-info-tint text-info",
  in_progress: "bg-info text-background",
  resolved: "bg-success-tint text-success",
  acknowledged: "border border-success/50 text-success",
  declined: "bg-brand-tint text-brand-text",
  closed: "bg-secondary text-muted-foreground",
};

const STATUS_ICON: Record<Status, typeof Clock3> = {
  new: CircleDot,
  needs_review: Clock3,
  awaiting_approval: Clock3,
  approved: CheckCircle2,
  in_progress: Hammer,
  resolved: CheckCircle2,
  acknowledged: ThumbsUp,
  declined: XCircle,
  closed: CheckCircle2,
};

// An ended item shows how it ended instead of "Closed" or "Declined" (D44).
const ENDING_TONE: Record<Ending, string> = {
  fixed: "bg-success-tint text-success",
  wont_fix: "bg-brand-tint text-brand-text",
  duplicate: "bg-secondary text-muted-foreground",
  declined: "bg-brand-tint text-brand-text",
  no_longer_needed: "bg-secondary text-muted-foreground",
};

const ENDING_ICON: Record<Ending, typeof Clock3> = {
  fixed: CheckCircle2,
  wont_fix: XCircle,
  duplicate: Copy,
  declined: XCircle,
  no_longer_needed: Minus,
};

export function StatusBadge({ status, ending = null, className }: { status: Status; ending?: Ending | null; className?: string }) {
  const Icon = ending ? ENDING_ICON[ending] : STATUS_ICON[status];
  return (
    <span className={cn(base, ending ? ENDING_TONE[ending] : STATUS_TONE[status], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {ending ? ENDING_LABEL[ending] : STATUS_LABEL[status]}
    </span>
  );
}

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const tone: Record<Stage, string> = {
    received: "border border-border text-foreground",
    approved: "bg-info-tint text-info",
    in_progress: "bg-info text-background",
    resolved: "bg-success-tint text-success",
    closed: "bg-secondary text-muted-foreground",
  };
  const Icon = stage === "in_progress" ? Hammer : stage === "received" ? CircleDot : CheckCircle2;
  return (
    <span className={cn(base, tone[stage], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {STAGE_LABEL[stage]}
    </span>
  );
}

/** Something on the item you haven't seen yet: a dot and the word, never the dot alone (D82). */
export function NewMark({ label = "New", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-foreground", className)}>
      <span className="size-2 rounded-full bg-foreground" aria-hidden="true" />
      {label}
    </span>
  );
}

export function WorkTypeBadge({ workType, className }: { workType: WorkType | null; className?: string }) {
  if (!workType) return null;
  return <span className={cn(base, "bg-secondary text-secondary-foreground", className)}>{WORK_TYPE_LABEL[workType]}</span>;
}
