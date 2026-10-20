"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Release } from "@/lib/api";
import { day } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Friday releases (brief §4.8): drafted by the agent each Friday, published only by the owner or an Admin. */
export default function ReleasesPage() {
  const me = useMe();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

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

  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Releases</h1>
          <p className="text-sm text-muted-foreground">
            Every Friday at 9:00 the agent drafts a release for each project with activity.
          </p>
        </div>
        {me.role === "admin" && (
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => void draftNow()} disabled={drafting}>
            {drafting && <Loader2 className="animate-spin" />} Draft this week now
          </Button>
        )}
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!releases && !error && <Skeleton className="h-40 rounded-3xl" />}
      {releases?.length === 0 && <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">No releases yet. The first draft is prepared on Friday.</p>}
      <ul className="grid gap-2">
        {releases?.map((r) => (
          <li key={r.id}>
            <Link href={`/console/releases/${r.id}`} className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-card hover:bg-muted/50">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.project.name}</span>
                <span className="text-sm text-muted-foreground">Week ending {day(r.week_ending)}</span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  r.status === "published" ? "bg-success-tint text-success" : "bg-warning-tint text-warning",
                )}
              >
                {r.status === "published" ? "Published" : r.can_publish ? "Draft · yours to review" : "Draft"}
              </span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
