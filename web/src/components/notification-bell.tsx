"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Notification } from "@/lib/api";
import { age, when } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

/**
 * The bell (brief §4.6): unread count live over server-sent events, falling back to polling
 * every 30 seconds if the stream drops. Clicking a notification opens its item.
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
    let poll: number | undefined;
    const stream = new EventSource("/api/notifications/stream");
    stream.addEventListener("unread", (e) => {
      setUnread(JSON.parse((e as MessageEvent<string>).data).unread);
      load();
    });
    stream.onerror = () => {
      stream.close();
      poll ??= window.setInterval(load, POLL_MS);
    };
    return () => {
      stream.close();
      if (poll) window.clearInterval(poll);
    };
  }, [load]);

  async function readAll() {
    await api.post("/notifications/read", {}).catch(() => undefined);
    load();
  }

  async function readOne(n: Notification) {
    setOpen(false);
    if (!n.read_at) await api.post("/notifications/read", { ids: [n.id] }).catch(() => undefined);
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
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link} onClick={() => readOne(n)} className="flex gap-3 px-4 py-3 hover:bg-muted">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-foreground")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !n.read_at && "font-semibold")}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-sm text-muted-foreground">{n.body}</span>}
                  <time dateTime={n.created_at} title={when(n.created_at)} className="font-mono text-xs text-muted-foreground tabular">
                    {age(n.created_at)}
                  </time>
                </span>
                {!n.read_at && <span className="sr-only">Unread</span>}
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
