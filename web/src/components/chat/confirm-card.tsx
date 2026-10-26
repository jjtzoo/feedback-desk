"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PriorityBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatCard, Priority } from "@/lib/api";

/** "Here's what I'll send" (brief §4.1.6): project, type, summary, priority (none for praise, D50),
 *  what happened for a fix, and what is still unknown with a box to add it (D63); Confirm or Change. */
export function ConfirmCard({
  card,
  busy,
  onConfirm,
  onChange,
  onAdd,
}: {
  card: ChatCard;
  busy: boolean;
  onConfirm: () => void;
  onChange: () => void;
  onAdd: (detail: string) => void;
}) {
  const [detail, setDetail] = useState("");
  const rows: [string, string][] = [
    ["Tool", card.project],
    ["Type", [card.work_type, card.category].filter(Boolean).join(" · ")],
    ["Title", card.title],
    ["Summary", card.summary !== card.title ? card.summary : ""],
    ["What happened", card.what_happened !== card.summary ? card.what_happened : ""],
  ];

  function add(e: FormEvent) {
    e.preventDefault();
    if (detail.trim()) onAdd(detail);
  }

  return (
    <section aria-labelledby="confirm-title" className="animate-fade-up rounded-2xl border bg-card p-4 shadow-card sm:p-5">
      <h3 id="confirm-title" tabIndex={-1} className="text-base font-bold outline-none">
        Your feedback
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
        {card.priority && (
          <>
            <dt className="font-medium text-muted-foreground">Priority</dt>
            <dd>
              <PriorityBadge priority={card.priority as Priority} />
            </dd>
          </>
        )}
      </dl>
      {card.gaps.length > 0 && (
        <form onSubmit={add} aria-labelledby="gaps-title" className="mt-4 rounded-xl bg-muted p-3">
          <p id="gaps-title" className="text-sm font-medium">
            We don&apos;t know yet
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {card.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <Label htmlFor="add-detail" className="mt-3">
            Add what you know
          </Label>
          <div className="mt-1.5 flex gap-2">
            <Input id="add-detail" value={detail} onChange={(e) => setDetail(e.target.value)} className="h-11 rounded-xl bg-card" disabled={busy} />
            <Button type="submit" variant="outline" className="h-11 rounded-xl px-4" disabled={busy || !detail.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
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
