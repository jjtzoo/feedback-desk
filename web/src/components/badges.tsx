import {
  CheckCircle2,
  CircleDot,
  Clock3,
  Hammer,
  Lightbulb,
  Minus,
  OctagonAlert,
  Sparkles,
  ThumbsUp,
  TriangleAlert,
  Wrench,
  XCircle,
} from "lucide-react";

import type { Priority, Stage, Status, WorkType } from "@/lib/api";
import { STAGE_LABEL, STATUS_LABEL, WORK_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

// Every badge pairs a word with an icon, so status never relies on colour (fire-services-ui).

const base = "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

export function PriorityBadge({ priority, className }: { priority: Priority | null; className?: string }) {
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
      {priority}
    </span>
  );
}

export function WorkTypeBadge({ workType, className }: { workType: WorkType | null; className?: string }) {
  if (!workType) return null;
  const styles: Record<WorkType, string> = {
    fix: "bg-info-tint text-info",
    improvement: "bg-success-tint text-success",
    new_feature: "bg-brand-tint text-brand-text",
    no_change: "bg-secondary text-muted-foreground",
  };
  const icons: Record<WorkType, typeof Wrench> = { fix: Wrench, improvement: Sparkles, new_feature: Lightbulb, no_change: ThumbsUp };
  const Icon = icons[workType];
  return (
    <span className={cn(base, styles[workType], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {WORK_TYPE_LABEL[workType]}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const tone: Record<Status, string> = {
    new: "border border-border text-foreground",
    needs_review: "bg-warning-tint text-warning",
    awaiting_approval: "bg-warning-tint text-warning",
    approved: "bg-info-tint text-info",
    in_progress: "bg-brand-tint text-brand-text",
    resolved: "bg-success-tint text-success",
    acknowledged: "bg-success-tint text-success",
    declined: "bg-secondary text-muted-foreground",
    closed: "bg-secondary text-muted-foreground",
  };
  const icon: Record<Status, typeof Clock3> = {
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
  const Icon = icon[status];
  return (
    <span className={cn(base, tone[status], className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const tone: Record<Stage, string> = {
    received: "border border-border text-foreground",
    approved: "bg-info-tint text-info",
    in_progress: "bg-brand-tint text-brand-text",
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
