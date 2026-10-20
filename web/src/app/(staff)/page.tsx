"use client";

import { ArrowRight, Link2, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";

import { StageBadge } from "@/components/badges";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/components/me";
import { api, type MyItem } from "@/lib/api";
import { age } from "@/lib/format";

const STEPS = [
  { title: "Describe it in your own words", body: "The assistant asks only what the team needs to act on it. You can attach a screenshot." },
  { title: "Review and confirm", body: "Nothing is submitted until you select Confirm." },
  { title: "Follow its progress", body: "You receive a reference such as FB-0137, a named owner and a tracker showing each stage." },
];

function Landing() {
  const me = useMe();
  const params = useSearchParams();
  const [recent, setRecent] = useState<MyItem[] | null>(null);
  const [recentError, setRecentError] = useState(false);

  const loadRecent = useCallback(() => {
    api
      .get<MyItem[]>("/my/feedback")
      .then((r) => setRecent(r.slice(0, 3)))
      .catch(() => setRecentError(true));
  }, []);
  useEffect(loadRecent, [loadRecent]);

  const firstName = me.name.split(" ")[0];
  return (
    <>
      {/* Mockup D: the red hero band. */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:pt-16 sm:pb-28">
          <p className="inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">Welcome, {firstName} · REDADAIR Digital Team</p>
          <h1 className="mt-4 max-w-[17ch] text-3xl leading-[1.05] font-extrabold sm:text-5xl">
            Tell us what&apos;s{" "}
            <span className="rounded-xl bg-card px-2 text-primary [box-decoration-break:clone]">not working</span>, or what could work better
          </h1>
          <p className="mt-5 hidden max-w-[54ch] text-lg leading-relaxed text-white/85 sm:block">
            Report a problem, request access or suggest an improvement for any intranet platform or agent. It takes about two minutes, and you
            can follow its progress at every stage.
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-20 grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <ChatPanel projectSlug={params.get("project")} />

        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
          <section className="rounded-3xl border bg-card p-6 shadow-card" aria-labelledby="next-steps">
            <h2 id="next-steps" className="text-lg font-bold">
              What happens next
            </h2>
            <ol className="mt-4 grid gap-4">
              {STEPS.map((s, i) => (
                <li key={s.title} style={{ "--i": i + 1 } as CSSProperties} className="grid animate-fade-up grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-primary font-extrabold text-primary-foreground" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    <span className="block font-semibold text-foreground">{s.title}</span>
                    {s.body}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-3xl border bg-card p-6 shadow-card" aria-labelledby="recent">
            <div className="flex items-center justify-between">
              <h2 id="recent" className="text-lg font-bold">
                Your recent feedback
              </h2>
              <Link href="/my" className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-brand-text hover:underline">
                View all <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            {recent === null && !recentError && (
              <div className="mt-3 grid gap-2" aria-busy="true">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            )}
            {recentError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  We couldn&apos;t load your recent feedback.
                  <Button variant="outline" className="h-11 rounded-xl" onClick={() => {
                      setRecentError(false);
                      loadRecent();
                    }}>
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {recent?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No feedback submitted yet. Anything you send will appear here with its progress.</p>}
            <ul className="mt-3 divide-y">
              {recent?.map((r) => (
                <li key={r.reference}>
                  <Link href={`/track/${r.reference}`} className="lift flex items-center gap-3 rounded-lg py-3 hover:bg-muted/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.title}</span>
                      <span className="font-mono text-xs text-muted-foreground tabular">
                        {r.reference} · {age(r.updated_at)}
                      </span>
                    </span>
                    <StageBadge stage={r.stage} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-8 gap-y-3 px-4 pb-12 text-sm text-muted-foreground sm:px-6">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Visible only to the Digital Team
        </span>
        <span className="inline-flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden="true" /> Every item has an owner and an approver
        </span>
        <span className="inline-flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden="true" /> Every item has a reference and a tracker
        </span>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
