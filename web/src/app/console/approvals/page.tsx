"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge } from "@/components/badges";
import { useCounts } from "@/components/console/counts";
import { RoutingLine } from "@/components/console/routing-line";
import { ActionDialog, type ActionKind, type ActionResult } from "@/components/console/action-dialogs";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Detail } from "@/lib/api";
import { WORK_TYPE_LABEL, age, recommendationText } from "@/lib/format";

/** Approvals queue for Admins (brief §4.5): P1 first, a recommendation on every item, one decision is enough. */
export default function ApprovalsPage() {
  const me = useMe();
  const { refresh: refreshCounts } = useCounts();
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
      refreshCounts();
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
      refreshCounts();
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
        <p className="text-sm text-muted-foreground">One Admin&apos;s decision is enough.</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => {
                setError(null);
                load();
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!items && !error && <Skeleton className="h-40 rounded-3xl" aria-busy="true" />}
      {items?.length === 0 && <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">All caught up. Items waiting for a decision appear here once they are routed.</p>}
      {items?.map((i) => (
        <article key={i.reference} className="rounded-3xl border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/console?inbox=open&item=${i.reference}`} className="font-mono text-sm font-semibold hover:underline">
              {i.reference}
            </Link>
            <PriorityBadge showCode priority={i.priority} />
            <StatusBadge status={i.status} />
            <span className="ml-auto font-mono text-xs text-muted-foreground">{age(i.created_at)}</span>
          </div>
          <h2 className="mt-2 text-lg font-bold">{i.title}</h2>
          <p className="text-sm text-muted-foreground">
            {i.work_type && `${WORK_TYPE_LABEL[i.work_type]} · `}{i.project?.name ?? "Tool to confirm"} · {i.area ?? "area not given"} · from {i.submitter_name}
          </p>
          <RoutingLine item={i} className="mt-1" />
          {i.dev_brief.problem && <p className="mt-3">{i.dev_brief.problem}</p>}
          {i.ai_recommendation?.decision && (
            <p className="mt-3 rounded-2xl bg-muted p-3 text-sm">
              <strong>{recommendationText(i.ai_recommendation, i.effort, i.impact).head}:</strong> {recommendationText(i.ai_recommendation, i.effort, i.impact).rest}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="h-11 rounded-xl px-5" disabled={busy === i.reference} onClick={() => void approve(i.reference)}>
              Approve
            </Button>
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setDialog({ kind: "decline", ref: i.reference })}>
              Decline
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setDialog({ kind: "ask", ref: i.reference })}>
              Ask for info
            </Button>
          </div>
        </article>
      ))}
      <ActionDialog key={`${dialog?.ref}-${dialog?.kind}`} kind={dialog?.kind ?? null} onClose={() => setDialog(null)} onSubmit={onDialog} />
    </div>
  );
}
