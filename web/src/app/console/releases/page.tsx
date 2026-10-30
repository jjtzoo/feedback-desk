"use client";

import { ChevronRight, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Release } from "@/lib/api";
import { day } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Published weeks shown before "Show older weeks". */
const WEEKS_SHOWN = 4;
/** A filter box only helps once the list is long. */
const FILTER_FROM = 8;

/** What a release holds, in words: how much was drafted and how much staff will see. */
function summary(r: Release): string {
  const ticked = r.items.filter((i) => i.visible_to_staff).length;
  const count = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  if (r.items.length === 0) return "No items";
  return r.status === "published" ? `${count(ticked)} shown to staff` : `${count(r.items.length)} drafted, ${ticked} ticked for staff`;
}

function Row({ r }: { r: Release }) {
  const draft = r.status !== "published";
  return (
    <Link href={`/console/releases/${r.id}`} className="flex min-h-14 items-center gap-4 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.project.name}</span>
        <span className="block text-sm text-muted-foreground">{summary(r)}</span>
      </span>
      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", draft ? "bg-warning-tint text-warning" : "bg-success-tint text-success")}>
        {draft ? (r.can_publish ? "Draft · yours to review" : "Draft") : "Published"}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** One bordered card of rows, so a long list reads as a few groups rather than dozens of boxes. */
function Group({ id, title, note, rows, tone }: { id: string; title: string; note?: string; rows: Release[]; tone?: "review" }) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 px-1">
        <h2 id={id} className="font-bold">
          {title}
        </h2>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      <ul className={cn("divide-y overflow-hidden rounded-2xl border bg-card shadow-card", tone === "review" && "border-warning/40")}>
        {rows.map((r) => (
          <li key={r.id}>
            <Row r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Friday releases (brief §4.8): drafted by the agent each Friday, published only by the owner or an Admin. */
export default function ReleasesPage() {
  const me = useMe();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState("");
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    api
      .get<Release[]>("/console/releases")
      .then((r) => {
        setError(null);
        setReleases(r);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function draftNow() {
    setConfirming(false);
    setDrafting(true);
    try {
      await api.post("/console/releases/draft-now");
      toast.success("This week's drafts are ready");
      load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDrafting(false);
    }
  }

  const { review, weeks, shown } = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    const rows = (releases ?? []).filter((r) => !wanted || r.project.name.toLowerCase().includes(wanted));
    const byName = (a: Release, b: Release) => a.project.name.localeCompare(b.project.name);
    const grouped = new Map<string, Release[]>();
    for (const r of rows.filter((r) => r.status === "published")) grouped.set(r.week_ending, [...(grouped.get(r.week_ending) ?? []), r]);
    const weeks = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([week, list]) => ({ week, rows: list.sort(byName) }));
    return { review: rows.filter((r) => r.status !== "published").sort(byName), weeks, shown: rows.length };
  }, [releases, filter]);
  const visibleWeeks = all ? weeks : weeks.slice(0, WEEKS_SHOWN);

  return (
    <div className="mx-auto grid max-w-4xl gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Releases</h1>
          <p className="text-sm text-muted-foreground">Every Friday at 9:00 the agent drafts a release for each project with activity.</p>
        </div>
        {me.role === "admin" && (
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => setConfirming(true)} disabled={drafting}>
            {drafting && <Loader2 className="animate-spin" />} Draft this week now
          </Button>
        )}
      </div>

      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {!releases && !error && <Skeleton className="h-40 rounded-3xl" />}
      {releases?.length === 0 && <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">No releases yet. The first draft is prepared on Friday.</p>}

      {releases && releases.length >= FILTER_FROM && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a tool" aria-label="Find a tool" className="h-11 rounded-xl pl-10" />
        </div>
      )}
      {releases && releases.length >= FILTER_FROM && shown === 0 && <p className="rounded-3xl border border-dashed p-8 text-center text-muted-foreground">No release matches “{filter.trim()}”.</p>}

      {review.length > 0 && <Group id="to-review" title="To review" note="Drafts waiting for their owner to tick, edit and publish" rows={review} tone="review" />}
      {visibleWeeks.map((w) => (
        <Group key={w.week} id={`week-${w.week}`} title={`Week ending ${day(w.week)}`} note={`${w.rows.length} published`} rows={w.rows} />
      ))}
      {weeks.length > WEEKS_SHOWN && (
        <Button variant="ghost" className="justify-self-center rounded-xl" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer weeks" : `Show older weeks (${weeks.length - WEEKS_SHOWN})`}
        </Button>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draft this week&apos;s releases?</DialogTitle>
            <DialogDescription>This makes a draft for each project with activity this week and tells its owner. A project that already has this week&apos;s release is skipped.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void draftNow()}>Draft now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
