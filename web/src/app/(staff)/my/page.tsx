"use client";

import { ChevronRight, Inbox, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StageBadge } from "@/components/badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type MyItem } from "@/lib/api";
import { age, when } from "@/lib/format";

/** "My feedback" (brief §4.1.8): every item the person raised or followed, open ones first. */
export default function MyFeedbackPage() {
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<MyItem[]>("/my/feedback").then(setItems).catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const open = items?.filter((i) => i.stage !== "closed") ?? [];
  const closed = items?.filter((i) => i.stage === "closed") ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">My feedback</h1>
          <p className="mt-1 text-muted-foreground">Everything you&apos;ve sent or added a comment to, and where each one is up to.</p>
        </div>
        <Button asChild className="h-11 rounded-xl px-5">
          <Link href="/chat">
            <MessageSquarePlus /> Give feedback
          </Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-8">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => {
                setError(null);
                load();
              }}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!items && !error && (
        <div className="mt-8 grid gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      )}
      {items?.length === 0 && (
        <div className="mt-10 grid justify-items-center gap-3 rounded-3xl border border-dashed p-12 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">No feedback yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Feedback you submit appears here with its reference and current stage.</p>
        </div>
      )}
      {[
        { title: "Open", list: open },
        { title: "Closed", list: closed },
      ].map(
        (group) =>
          group.list.length > 0 && (
            <section key={group.title} className="mt-8" aria-labelledby={`group-${group.title}`}>
              <h2 id={`group-${group.title}`} className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground">
                {group.title} · {group.list.length}
              </h2>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {group.list.map((i) => (
                  <li key={i.reference}>
                    <Link
                      href={`/track/${i.reference}`}
                      className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-brand-text">{i.reference}</span>
                          {i.following && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">Following</span>}
                        </span>
                        <span className="mt-1 block truncate font-semibold">{i.title}</span>
                        <span className="text-sm text-muted-foreground">
                          {i.project ?? "Tool to confirm"} · {i.status_text} ·{" "}
                          <time dateTime={i.updated_at} title={when(i.updated_at)}>
                            updated {age(i.updated_at)} ago
                          </time>
                        </span>
                      </span>
                      <StageBadge stage={i.stage} className="hidden sm:inline-flex" />
                      <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}
