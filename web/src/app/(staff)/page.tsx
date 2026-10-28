"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { PROJECT_GROUPS } from "@/components/chat/app-cards";
import { STARTERS } from "@/components/chat/starters";
import { useMe } from "@/components/me";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type MyItem, type Project } from "@/lib/api";
import { age } from "@/lib/format";

const STEPS = [
  { title: "Tell Sig in your own words", body: "Up to three quick questions. You can attach a screenshot." },
  { title: "Check the summary", body: "Nothing is sent until you select Confirm." },
  { title: "Follow it like a parcel", body: "A reference such as FB-0137 and a tracker that shows who has it." },
];

/**
 * The staff home, laid out like a help centre (IA audit 2026-10-23, after JSM and Canny): one clear
 * action, then the kinds of request to start from, then the person's own recent feedback.
 */
function Landing() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [recent, setRecent] = useState<MyItem[] | null>(null);
  const [recentError, setRecentError] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Old deep links (`/?project=rake-agent`) now open the chat.
  const project = params.get("project");
  useEffect(() => {
    if (project) router.replace(`/chat?project=${encodeURIComponent(project)}`);
  }, [project, router]);

  const loadRecent = useCallback(() => {
    api
      .get<MyItem[]>("/my/feedback")
      .then((r) => setRecent(r.slice(0, 3)))
      .catch(() => setRecentError(true));
  }, []);
  useEffect(loadRecent, [loadRecent]);
  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(() => undefined);
  }, []);

  const firstName = me.name.split(" ")[0];
  return (
    <>
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-sm font-semibold text-white/80">Hi {firstName}</p>
          <h1 className="mt-2 text-3xl font-extrabold text-balance sm:text-4xl">What can we help you with?</h1>
          <p className="mt-3 max-w-[60ch] leading-relaxed text-white/85 sm:text-lg">
            Tell Sig, our assistant, about a problem, an idea or access you need, for any intranet platform or agent. It takes about two
            minutes.
          </p>
          <Button asChild className="mt-6 h-12 rounded-xl bg-card px-6 text-base text-primary hover:bg-card/90">
            <Link href="/chat">
              Give feedback <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card role="region" aria-labelledby="start-heading" className="gap-0 py-0">
          <h2 id="start-heading" className="px-5 pt-5 pb-2 text-base font-bold">
            Or start from one of these
          </h2>
          <ul data-tour="start-cards" className="divide-y px-2">
            {STARTERS.map(({ id, icon: Icon, label, blurb }) => (
              <li key={id}>
                <Link href={`/chat?start=${id}`} className="flex items-center gap-4 rounded-lg px-3 py-3 hover:bg-muted/60">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground" aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-sm text-muted-foreground">{blurb}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {projects.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-4">
              <h2 id="tools-heading" className="text-sm font-semibold">
                Already know which tool?
              </h2>
              <Select onValueChange={(slug) => router.push(`/chat?project=${encodeURIComponent(slug)}`)}>
                <SelectTrigger className="h-11 w-64 rounded-xl" aria-labelledby="tools-heading">
                  <SelectValue placeholder="Choose a tool" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_GROUPS.map((g) => {
                    const list = projects.filter((p) => p.project_group === g.key);
                    if (list.length === 0) return null;
                    return (
                      <SelectGroup key={g.key}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {list.map((p) => (
                          <SelectItem key={p.slug} value={p.slug}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </Card>

        <Card role="region" aria-labelledby="recent" className="gap-0 self-start px-5 py-5">
          <div className="flex items-center justify-between">
            <h2 id="recent" className="text-base font-bold">
              Your recent feedback
            </h2>
            <Link href="/my" className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline">
              View all <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {recent === null && !recentError && (
            <div className="mt-2 grid gap-2" aria-busy="true">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          )}
          {recentError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                We couldn&apos;t load your recent feedback.
                <Button
                  variant="outline"
                  className="h-11 rounded-xl"
                  onClick={() => {
                    setRecentError(false);
                    loadRecent();
                  }}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {recent?.length === 0 && (
            <div className="mt-2 grid justify-items-center gap-3 py-4 text-center">
              <Image src="/brand/sig/sig-3d.svg" alt="" width={64} height={77} unoptimized />
              <p className="text-sm text-muted-foreground">Nothing here yet. Anything you send shows up here, with where it&apos;s up to.</p>
            </div>
          )}
          <ul className="divide-y">
            {recent?.map((r) => (
              <li key={r.reference}>
                <Link href={`/track/${r.reference}`} className="flex items-center gap-3 rounded-lg py-3 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.title}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular">
                      {r.reference} · {age(r.updated_at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-sm">{r.status_text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <section aria-labelledby="next-steps" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <h2 id="next-steps" className="text-sm font-semibold">
          How it works
        </h2>
        <ol className="mt-3 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 text-sm">
              <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-bold" aria-hidden="true">
                {i + 1}
              </span>
              <span className="leading-relaxed text-muted-foreground">
                <span className="block font-semibold text-foreground">{s.title}</span>
                {s.body}
              </span>
            </li>
          ))}
        </ol>
      </section>
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
