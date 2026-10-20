"use client";

import { Bot, CircleSlash, Gavel, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge, WorkTypeBadge } from "@/components/badges";
import { ActionDialog, type ActionKind, type ActionResult } from "@/components/console/action-dialogs";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Detail } from "@/lib/api";
import { age } from "@/lib/format";

/** Approvals queue for Admins (brief §4.5): P1 first, a recommendation on every item, one decision is enough. */
export default function ApprovalsPage() {
  const me = useMe();
  const [items, setItems] = useState<Detail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: ActionKind; ref: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Detail[]>("/console/approvals")
      .then((r) => {
        setError(null);
        setItems(r);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function approve(ref: string) {
    setBusy(ref);
    try {
      await api.post(`/console/items/${ref}/approve`);
      toast.success(`${ref} approved`);
      load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDialog(kind: ActionKind, r: ActionResult): Promise<boolean> {
    if (!dialog) return false;
    try {
      if (kind === "decline") await api.post(`/console/items/${dialog.ref}/decline`, { reason: r.text });
      else await api.post(`/console/items/${dialog.ref}/ask-info`, { question: r.text, ask: r.ask });
      toast.success(kind === "decline" ? `${dialog.ref} declined` : "Question sent");
      load();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }

  if (me.role !== "admin") {
    return <p className="p-6 text-muted-foreground">Approvals are for Admins (Mike, Chris or Marc).</p>;
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-extrabold">Approvals</h1>
        <p className="text-sm text-muted-foreground">Approve means we&apos;ll do it; decline means we won&apos;t, and the person is told why. One Admin&apos;s decision is enough.</p>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!items && !error && <Skeleton className="h-40 rounded-3xl" aria-busy="true" />}
      {items?.length === 0 && <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">No items awaiting approval. New items appear here once the agent has routed them.</p>}
      {items?.map((i) => (
        <article key={i.reference} className={`rounded-3xl border bg-card p-5 shadow-card ${i.priority === "P1" ? "border-[1.5px] border-primary/70" : ""}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/console?inbox=open&item=${i.reference}`} className="font-mono text-sm font-semibold text-brand-text hover:underline">
              {i.reference}
            </Link>
            <WorkTypeBadge workType={i.work_type} />
            <PriorityBadge showCode priority={i.priority} />
            <StatusBadge status={i.status} />
            <span className="ml-auto font-mono text-xs text-muted-foreground">{age(i.created_at)}</span>
          </div>
          <h2 className="mt-2 text-lg font-bold">{i.title}</h2>
          <p className="text-sm text-muted-foreground">
            {i.project?.name ?? "Tool to confirm"} · {i.area ?? "area not given"} · from {i.submitter_name} · owner {i.assignee?.name ?? "not set"}
          </p>
          {i.dev_brief.problem && <p className="mt-3">{i.dev_brief.problem}</p>}
          {i.ai_recommendation?.decision && (
            <p className="mt-3 flex gap-2 rounded-2xl bg-muted p-3 text-sm">
              <Bot className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden="true" />
              <span>
                <strong>{i.ai_recommendation.decision.replace("_", " ")}</strong>: {i.ai_recommendation.reason} Effort {i.effort ?? "?"}, impact{" "}
                {(i.impact ?? "unknown").replace("_", " ")}.
              </span>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="h-11 rounded-xl px-5" disabled={busy === i.reference} onClick={() => void approve(i.reference)}>
              <Gavel /> Approve
            </Button>
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setDialog({ kind: "decline", ref: i.reference })}>
              <CircleSlash /> Decline
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setDialog({ kind: "ask", ref: i.reference })}>
              <MessageCircleQuestion /> Ask for info
            </Button>
          </div>
        </article>
      ))}
      <ActionDialog kind={dialog?.kind ?? null} onClose={() => setDialog(null)} onSubmit={onDialog} />
    </div>
  );
}
