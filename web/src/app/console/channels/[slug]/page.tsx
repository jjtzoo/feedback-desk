"use client";

import { ArrowLeft, Loader2, Pin, PinOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Channel, type ChannelMessage } from "@/lib/api";
import { STATUS_LABEL, initials, when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Turns #FB-0139 into a live chip and @name into a highlight. */
function Body({ text, chips }: { text: string; chips: Channel["chips"] }) {
  const parts = text.split(/(#FB-\d{4,}|@[A-Za-z][\w.-]*)/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i): ReactNode => {
        const ref = part.match(/^#(FB-\d{4,})$/i)?.[1]?.toUpperCase();
        if (ref) {
          const chip = chips[ref];
          return (
            <Link key={i} href={`/console?inbox=all&item=${ref}`} className="mx-0.5 inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pr-1 pl-2 align-middle text-xs hover:bg-muted/50">
              <span className="font-mono font-semibold">{ref}</span>
              <span className="text-muted-foreground">{chip ? STATUS_LABEL[chip.status] : "unknown"}</span>
            </Link>
          );
        }
        if (part.startsWith("@")) return <span key={i} className="font-semibold">{part}</span>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

export default function ChannelPage() {
  const { slug } = useParams<{ slug: string }>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Channel>(`/console/channels/${slug}`)
      .then((c) => {
        setError(null);
        setChannel(c);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [slug]);
  useEffect(load, [load]);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/console/channels/${slug}`, { body: text });
      setText("");
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function pin(m: ChannelMessage) {
    try {
      await api.post(`/console/channels/messages/${m.id}/pin`, { pinned: !m.pinned });
      load();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const pinned = channel?.messages.filter((m) => m.pinned) ?? [];
  const rest = [...(channel?.messages.filter((m) => !m.pinned) ?? [])].reverse();

  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-6">
      <Link href="/console/channels" className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Channels
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold"># {channel?.project.name ?? slug}</h1>
        <p className="text-sm text-muted-foreground">Mention a teammate with @name, link an item with #FB-0139. Pin decisions and how-tos.</p>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!channel && !error && <Skeleton className="h-60 rounded-3xl" />}

      {pinned.length > 0 && (
        <section className="grid gap-2 rounded-3xl border bg-card p-4 shadow-card" aria-label="Pinned">
          <p className="text-sm font-semibold text-muted-foreground">Pinned</p>
          {pinned.map((m) => (
            <Message key={m.id} m={m} chips={channel?.chips ?? {}} onPin={() => void pin(m)} />
          ))}
        </section>
      )}

      {channel && (
        <ol className="grid gap-1 rounded-3xl border bg-card p-2 shadow-card">
          {rest.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No messages yet. Start the conversation for this project.</li>}
          {rest.map((m) => (
            <li key={m.id}>
              <Message m={m} chips={channel.chips} onPin={() => void pin(m)} />
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={post} className="flex items-end gap-2">
        <label htmlFor="channel-text" className="sr-only">
          Message
        </label>
        <Textarea
          id="channel-text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Write to the team"
          className="min-h-12 flex-1 rounded-xl"
        />
        <Button type="submit" className="h-12 rounded-xl px-5" disabled={busy || !text.trim()}>
          {busy && <Loader2 className="animate-spin" />} Post
        </Button>
      </form>
    </div>
  );
}

function Message({ m, chips, onPin }: { m: ChannelMessage; chips: Channel["chips"]; onPin: () => void }) {
  return (
    <div className={cn("group flex gap-3 rounded-2xl p-3 hover:bg-muted/50")}>
      <Avatar className="size-9">
        <AvatarFallback className="bg-muted text-xs font-bold">{initials(m.author_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{m.author_name}</span> · {when(m.created_at)}
        </p>
        <Body text={m.body} chips={chips} />
      </div>
      <Button variant="ghost" size="icon" onClick={onPin} aria-label={m.pinned ? "Unpin" : "Pin"} className="opacity-60 group-hover:opacity-100">
        {m.pinned ? <PinOff /> : <Pin />}
      </Button>
    </div>
  );
}
