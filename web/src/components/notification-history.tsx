"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ItemBadge } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Notification } from "@/lib/api";
import { day } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Today", "Yesterday" or "Tue 28 Oct", for the day headings. */
function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day(iso);
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

/** Every notification of the last 90 days, cleared from the bell or not, newest first, by day (D108). */
export function NotificationHistory() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((next: number) => {
    api
      .get<{ items: Notification[]; more: boolean }>(`/notifications/history?page=${next}`)
      .then((r) => {
        setItems((all) => (next === 1 ? r.items : [...(all ?? []), ...r.items]));
        setMore(r.more);
        setPage(next);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(() => load(1), [load]);

  function open(n: Notification) {
    if (!n.read_at) void api.post("/notifications/read", { ids: [n.id] }).catch(() => undefined);
  }

  if (error) return <p className="text-destructive" role="alert">{error}</p>;
  if (!items) return <Skeleton className="h-48 rounded-3xl" aria-busy="true" />;
  if (items.length === 0) {
    return <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">No notifications in the last 90 days.</p>;
  }

  const days = new Map<string, Notification[]>();
  for (const n of items) days.set(dayHeading(n.created_at), [...(days.get(dayHeading(n.created_at)) ?? []), n]);

  return (
    <div className="grid gap-6">
      {[...days.entries()].map(([heading, rows]) => (
        <section key={heading} aria-label={heading} className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{heading}</h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {rows.map((n) => {
              const said = n.body && !n.outcome ? n.body : null;
              return (
                <li key={n.id}>
                  <Link href={n.link} onClick={() => open(n)} className="flex gap-3 px-4 py-3 hover:bg-muted">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-foreground")} aria-hidden="true" />
                    <span className="grid min-w-0 flex-1 gap-1.5">
                      <span className={cn("block text-sm text-foreground", n.read_at ? "font-medium" : "font-semibold")}>{n.outcome ?? n.title}</span>
                      {said && <span className="line-clamp-3 block border-l-2 pl-2.5 text-sm text-foreground/80">{said}</span>}
                      <span className="flex flex-wrap items-center gap-2">
                        <ItemBadge n={n} />
                        <time dateTime={n.created_at} className="font-mono text-xs text-muted-foreground tabular">
                          {time(n.created_at)}
                        </time>
                      </span>
                    </span>
                    {!n.read_at && <span className="sr-only">Unread</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {more && (
        <Button variant="outline" className="h-11 justify-self-center rounded-xl" onClick={() => load(page + 1)}>
          Show older
        </Button>
      )}
    </div>
  );
}
