import { Lock, Pin } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials, when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Something someone wrote, or a change to the item, as one line of the conversation. */
export type ThreadEntry = {
  key: string;
  at: string;
  /** Set on a message: who wrote it. Events have none. */
  who?: string;
  /** What they are on this item, such as "Developer · has it". */
  role?: string;
  text: string;
  /** Only the Digital team sees it (D96). */
  internal?: boolean;
  pinned?: boolean;
  /** For notifications and "Sent just now" to scroll to. */
  domId?: string;
  ring?: boolean;
  /** Small marks before the name, such as New or Sent just now. */
  marks?: ReactNode;
};

/** One conversation per item (D105): messages and changes together, oldest at the top, sitting straight on
 *  the page. An internal message has an amber line and a lock, never a box. */
export function ActivityThread({ entries, empty }: { entries: ThreadEntry[]; empty: string }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="grid gap-4">
      {entries.map((e) =>
        e.who ? (
          <li key={e.key} id={e.domId} className={cn("grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg transition-shadow", e.ring && "ring-2 ring-ring ring-offset-4")}>
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-xs font-bold">{initials(e.who)}</AvatarFallback>
            </Avatar>
            <div className={cn("min-w-0 text-sm", e.internal && "border-l-2 border-warning pl-3")}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {e.marks}
                <span className="text-sm font-semibold text-foreground">{e.who}</span>
                {e.role && <span>{e.role}</span>}
                {e.internal && (
                  <span className="inline-flex items-center gap-1 font-semibold text-warning">
                    <Lock className="size-3" aria-hidden="true" /> Internal{e.pinned && " · pinned"}
                  </span>
                )}
                {e.pinned && !e.internal && <Pin className="size-3" aria-label="Pinned" />}
                <time dateTime={e.at}>{when(e.at)}</time>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{e.text}</p>
            </div>
          </li>
        ) : (
          <li key={e.key} id={e.domId} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 text-xs text-muted-foreground">
            <span className="flex justify-center pt-1" aria-hidden="true">
              <span className="size-1.5 rounded-full bg-muted-foreground/50" />
            </span>
            <p>
              {e.text}
              {e.internal && <span className="ml-1">(internal)</span>} · <time dateTime={e.at}>{when(e.at)}</time>
            </p>
          </li>
        ),
      )}
    </ol>
  );
}

/** Who is in the conversation, with what they are on the item, above the thread. Someone with two parts,
 *  such as the person who raised it and approved it, shows once with both. */
export function ThreadPeople({ people }: { people: { name: string; role?: string }[] }) {
  const once = new Map<string, string[]>();
  for (const p of people) once.set(p.name, [...(once.get(p.name) ?? []), ...(p.role ? [p.role] : [])]);
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3 text-sm">
      <span className="text-muted-foreground">In this conversation</span>
      {[...once].map(([name, roles]) => (
        <span key={name} className="inline-flex items-center gap-2">
          <Avatar className="size-6">
            <AvatarFallback className="bg-muted text-[10px] font-bold">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{name}</span>
          {roles.length > 0 && <span className="text-xs text-muted-foreground">{roles.join(" · ")}</span>}
        </span>
      ))}
    </p>
  );
}
