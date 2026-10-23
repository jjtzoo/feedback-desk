import { CheckCircle2, CircleDot, Clock3, Hammer, Minus, OctagonAlert, ThumbsUp, TriangleAlert, XCircle } from "lucide-react";

import type { Priority, Stage, Status } from "@/lib/api";
import { PRIORITY_LABEL, PRIORITY_WORD, STAGE_LABEL, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

// Every badge pairs a word with an icon, so status never relies on colour (fire-services-ui).

const base = "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

/** Staff see the word ("Major"); the console passes `showCode` for "P2 · Major". */
export function PriorityBadge({ priority, showCode = false, className }: { priority: Priority | null; showCode?: boolean; className?: string }) {
  if (!priority) return null;
  const styles: Record<Priority, string> = {
    P1: "border-[1.5px] border-primary bg-brand-tint text-brand-text",
    P2: "bg-warning-tint text-warning",
    P3: "bg-secondary text-secondary-foreground",
    P4: "bg-secondary text-muted-foreground",
  };
  const Icon = priority === "P1" ? OctagonAlert : priority === "P2" ? TriangleAlert : Minus;
  return (
    <span className={cn(base, styles[priority], className)}>
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

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn(base, STATUS_TONE[status], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {STATUS_LABEL[status]}
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
