"use client";

import { Loader2 } from "lucide-react";

import { PriorityBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import type { ChatCard, Priority } from "@/lib/api";

/** "Here's what I'll send" (brief §4.1.6): project, type, summary, priority; Confirm or Change. */
export function ConfirmCard({
  card,
  busy,
  onConfirm,
  onChange,
}: {
  card: ChatCard;
  busy: boolean;
  onConfirm: () => void;
  onChange: () => void;
}) {
  const rows: [string, string][] = [
    ["Tool", card.project],
    ["Type", [card.work_type, card.category].filter(Boolean).join(" · ")],
    ["Title", card.title],
    ["Summary", card.summary !== card.title ? card.summary : ""],
  ];
  return (
    <section aria-labelledby="confirm-title" className="animate-fade-up rounded-2xl border bg-card p-4 shadow-card sm:p-5">
      <h3 id="confirm-title" tabIndex={-1} className="text-base font-bold outline-none">
        Here&apos;s what I&apos;ll send. Is this right?
      </h3>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[6rem_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-muted-foreground">{k}</dt>
              <dd className="whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        <dt className="font-medium text-muted-foreground">Priority</dt>
        <dd>
          <PriorityBadge priority={(card.priority || null) as Priority | null} />
        </dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-11 rounded-xl px-5 text-base" onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Confirm
        </Button>
        <Button variant="outline" className="h-11 rounded-xl px-5 text-base" onClick={onChange} disabled={busy}>
          Change
        </Button>
      </div>
    </section>
  );
}
