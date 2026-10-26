"use client";

import { ArrowRight, Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StageBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Notification } from "@/lib/api";
import { age, when } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
const RETRY_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * The bell (brief §4.6): unread count live over server-sent events. While the stream is down it
 * polls every 30 seconds and keeps reconnecting (an API restart, a deploy, Cloud Run's request
 * timeout); once the stream is back, polling stops. Clicking a notification opens its item.
 * A request someone has already acted on shows what happened instead ("FB-0003 approved by Chris"),
 * and each item's badge is its stage now, so an old message never contradicts the item (D54).
 * One row per item: its latest step on top, the steps so far as a trail, the summary once; the row
 * is unread while any step in it is, and opening it reads them all (D78).
 */
export function NotificationBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ items: Notification[]; unread: number }>("/notifications")
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    let stream: EventSource | undefined;
    let poll: number | undefined;
    let retry: number | undefined;
    let delay = RETRY_MS;

    function connect() {
      const source = new EventSource("/api/notifications/stream");
      stream = source;
      source.onopen = () => {
        delay = RETRY_MS;
        window.clearInterval(poll);
        poll = undefined;
      };
      source.addEventListener("unread", (e) => {
        setUnread(JSON.parse((e as MessageEvent<string>).data).unread);
        load();
      });
      source.onerror = () => {
        poll ??= window.setInterval(load, POLL_MS);
        // A dropped connection the browser retries by itself; an error answer makes it give up.
        if (source.readyState === EventSource.CLOSED) {
          retry = window.setTimeout(connect, delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        }
      };
    }

    connect();
    return () => {
      stream?.close();
      window.clearInterval(poll);
      window.clearTimeout(retry);
    };
  }, [load]);

  async function readAll() {
    await api.post("/notifications/read", {}).catch(() => undefined);
    load();
  }

  async function readGroup(group: Notification[]) {
    setOpen(false);
    const ids = group.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length) await api.post("/notifications/read", { ids }).catch(() => undefined);
    load();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn("relative size-11 rounded-full", tone === "dark" && "text-band-foreground hover:bg-white/10 hover:text-band-foreground")}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 grid min-w-5 place-items-center rounded-full bg-foreground px-1 font-mono text-[11px] font-semibold text-background tabular">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={readAll}>
              Mark all read
            </Button>
          )}
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto" aria-live="polite">
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No updates yet. Progress on your feedback appears here.</li>}
          {byItem(items).map((group) => {
            const n = group[group.length - 1];
            const unreadRow = group.some((g) => !g.read_at);
            const trail = steps(group);
            const summary = [...group].reverse().find((g) => g.body && !g.outcome)?.body;
            return (
              <li key={n.id}>
                <Link href={n.link} onClick={() => readGroup(group)} className="flex gap-3 px-4 py-3 hover:bg-muted">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unreadRow ? "bg-foreground" : "bg-transparent")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", unreadRow && "font-semibold")}>{n.outcome ?? n.title}</span>
                    {trail.length > 1 && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label={`Steps so far: ${trail.join(", then ")}`}>
                        {trail.map((step, i) => (
                          <span key={`${step}-${i}`} className="inline-flex items-center gap-1" aria-hidden="true">
                            {i > 0 && <ArrowRight className="size-3" />}
                            {step}
                          </span>
                        ))}
                      </span>
                    )}
                    {summary && <span className="line-clamp-2 block text-sm text-muted-foreground">{summary}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <ItemBadge n={n} />
                      <time dateTime={n.created_at} title={when(n.created_at)} className="font-mono text-xs text-muted-foreground tabular">
                        {age(n.created_at)}
                      </time>
                    </span>
                  </span>
                  {unreadRow && <span className="sr-only">Unread</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** One group per item, newest group first; each group oldest step first. Rows with no item (the standing
 *  approvals count, digests) stay on their own (D55). The API lists newest first. */
function byItem(items: Notification[]): Notification[][] {
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const key = n.feedback_id ?? n.id;
    groups.set(key, [n, ...(groups.get(key) ?? [])]);
  }
  return [...groups.values()];
}

/** The steps in order, a repeat in a row shown once ("Update → Reply", not "Update → Update → Reply"). */
function steps(group: Notification[]): string[] {
  return group.map((n) => n.step ?? n.title).filter((step, i, all) => step !== all[i - 1]);
}

/** The item's stage now: console words for the Digital team, the staff stage on a staff tracker link; an ended item shows its ending. */
function ItemBadge({ n }: { n: Notification }) {
  const small = "h-5 px-2 text-[11px]";
  if (!n.item_status) return null;
  if (n.link.startsWith("/console") || n.item_ending) return <StatusBadge status={n.item_status} ending={n.item_ending} className={small} />;
  return n.item_stage ? <StageBadge stage={n.item_stage} className={small} /> : null;
}
