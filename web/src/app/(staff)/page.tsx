"use client";

import { ArrowRight, Link2, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { StageBadge } from "@/components/badges";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useMe } from "@/components/me";
import { api, type MyItem } from "@/lib/api";
import { age } from "@/lib/format";

const STEPS = [
  { title: "Tell us in your own words", body: "The assistant asks only what the team needs. Attach a screenshot if it helps." },
  { title: "Check the summary", body: "Nothing is sent until you press Confirm." },
  { title: "Track it", body: "You get a reference like FB-0137, an owner, and a tracker you can follow." },
];

function Landing() {
  const me = useMe();
  const params = useSearchParams();
  const [recent, setRecent] = useState<MyItem[] | null>(null);

  useEffect(() => {
    api.get<MyItem[]>("/my/feedback").then((r) => setRecent(r.slice(0, 3))).catch(() => setRecent([]));
  }, []);

  const firstName = me.name.split(" ")[0];
  return (
    <>
      {/* Mockup D: the red hero band. */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-28 sm:px-6 sm:pt-16">
          <p className="inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">Hi {firstName} · REDADAIR Digital team</p>
          <h1 className="mt-4 max-w-[17ch] text-4xl leading-[1.05] font-extrabold sm:text-5xl">
            Tell us what&apos;s{" "}
            <span className="rounded-xl bg-card px-2 text-primary [box-decoration-break:clone]">not working</span>, or what would help
          </h1>
          <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-white/85">
            Problems, access requests and ideas about any intranet platform or agent. It takes about two minutes, and you can follow it like a
            parcel.
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
                <li key={s.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
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
              <Link href="/my" className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-brand-text hover:underline">
                All <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            {recent === null && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
            {recent?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nothing yet. What you send shows up here with its progress.</p>}
            <ul className="mt-3 divide-y">
              {recent?.map((r) => (
                <li key={r.reference}>
                  <Link href={`/track/${r.reference}`} className="flex items-center gap-3 rounded-lg py-3 hover:bg-muted/60">
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
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Only the Digital team sees your feedback
        </span>
        <span className="inline-flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden="true" /> Every item has an owner and an approver
        </span>
        <span className="inline-flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden="true" /> Every item gets a reference and a tracker
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
