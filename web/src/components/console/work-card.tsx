"use client";

import { Flag, Paperclip } from "lucide-react";

import { PriorityBadge, WorkTypeBadge } from "@/components/badges";
import type { Card } from "@/lib/api";
import { STATUS_LABEL, age, day, when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A card on the board and in Cards view (brief §4.4). */
export function WorkCard({ card, onOpen, showStatus = false, dragging = false }: { card: Card; onOpen: () => void; showStatus?: boolean; dragging?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative grid w-full gap-2 rounded-2xl border bg-card p-3.5 text-left shadow-card transition-[border-color,transform] hover:border-foreground/30",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      {card.unread_reply && (
        <span className="absolute top-3 right-3 size-2.5 rounded-full bg-foreground" title="The submitter replied" aria-label="Unread reply from the submitter" />
      )}
      <span className="flex flex-wrap items-center gap-1.5 pr-4">
        <span className="font-mono text-xs font-semibold">{card.reference}</span>
        <PriorityBadge showCode priority={card.priority} className="h-5 px-2 text-[11px]" />
        <WorkTypeBadge workType={card.work_type} className="h-5 px-2 text-[11px]" />
        {card.flagged && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
            <Flag className="size-3" aria-hidden="true" /> Flagged
          </span>
        )}
      </span>
      <span className="line-clamp-2 font-semibold leading-snug">{card.title}</span>
      <span className="text-sm text-muted-foreground">
        {[card.project?.name ?? "Tool to confirm", card.submitter_name].join(" · ")}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showStatus && <span className="font-semibold text-foreground">{STATUS_LABEL[card.status]}</span>}
        <time dateTime={card.created_at} title={when(card.created_at)} className="font-mono tabular">
          {age(card.created_at)}
        </time>
        {card.expected_by && (
          <span className={cn(card.overdue && "font-semibold text-destructive")}>
            {card.overdue ? "Overdue · " : "Due "}
            {day(card.expected_by)}
          </span>
        )}
        {card.has_files && (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Has files</span>
          </span>
        )}
        {card.assignee && <span className="ml-auto truncate">{card.assignee.name}</span>}
      </span>
    </button>
  );
}
