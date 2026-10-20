"use client";

import { ArrowRight, Link2, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";

import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { STARTERS } from "@/components/chat/starters";
import { useMe } from "@/components/me";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type MyItem, type Project } from "@/lib/api";
import { age } from "@/lib/format";

const STEPS = [
  { title: "Describe it in your own words", body: "The assistant asks only what the team needs to act on it. You can attach a screenshot." },
  { title: "Review and confirm", body: "Nothing is submitted until you select Confirm." },
  { title: "Follow its progress", body: "You receive a reference such as FB-0137, a named owner and a tracker showing each stage." },
];

const GROUPS: { key: Project["project_group"]; label: string }[] = [
  { key: "platforms", label: "Platforms" },
  { key: "agents", label: "Agents" },
  { key: "other", label: "Other" },
];

const rise = (i: number) => ({ "--i": i }) as CSSProperties;

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
      {/* Mockup D: the red hero band. */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-28 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <p className="text-sm font-semibold text-white/80">Hi {firstName}</p>
            <h1 className="mt-4 max-w-[17ch] text-4xl leading-[1.05] font-extrabold sm:text-5xl">
              Tell us what&apos;s{" "}
              <span className="rounded-xl bg-card px-2 text-primary [box-decoration-break:clone]">not working</span>, or what could work better
            </h1>
            <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-white/85">
              Report a problem, request access or suggest an improvement for any intranet platform or agent. It takes about two minutes, and you
              can follow its progress at every stage.
            </p>
            <Button asChild className="mt-7 h-12 rounded-xl bg-card px-6 text-base text-primary hover:bg-card/90">
              <Link href="/chat">
                Start a conversation <ArrowRight />
              </Link>
            </Button>
          </div>

          {/* A taste of the conversation. Decorative; the real one is on /chat. */}
          <div aria-hidden="true" className="hidden animate-fade-up rounded-3xl bg-card p-5 text-card-foreground shadow-card lg:block">
            <div className="flex items-center gap-3 border-b pb-4">
              <AssistantAvatar className="size-11" />
              <div>
                <p className="font-bold">Feedback assistant</p>
                <p className="text-sm text-muted-foreground">Asks a few questions, then sends it on</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-[15px]">
              <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-4 py-2.5">G&apos;day! What&apos;s on your mind?</p>
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-band px-4 py-2.5 text-band-foreground">
                The RAKE Agent times out on big PDFs.
              </p>
              <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-4 py-2.5">Thanks. How much is it affecting your work?</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto -mt-16 grid max-w-6xl gap-10 px-4 pb-12 sm:px-6">
        <section aria-labelledby="start-heading">
          <h2 id="start-heading" className="sr-only">
            What would you like to do?
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STARTERS.map(({ id, icon: Icon, label, blurb }, i) => (
              <li key={id} style={rise(i)} className="animate-fade-up">
                <Link
                  href={`/chat?start=${id}`}
                  className="lift grid h-full gap-3 rounded-3xl border bg-card p-5 shadow-card hover:border-foreground/20"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-muted text-foreground" aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-bold">{label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{blurb}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {projects.length > 0 && (
          <section aria-labelledby="tools-heading" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 id="tools-heading" className="text-sm font-semibold">
              Already know which tool?
            </h2>
            <Select onValueChange={(slug) => router.push(`/chat?project=${encodeURIComponent(slug)}`)}>
              <SelectTrigger className="h-11 w-64 rounded-xl" aria-labelledby="tools-heading">
                <SelectValue placeholder="Choose a tool" />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => {
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
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-3xl border bg-card p-6 shadow-card" aria-labelledby="next-steps">
            <h2 id="next-steps" className="text-lg font-bold">
              How it works
            </h2>
            <ol className="mt-4 grid gap-4">
              {STEPS.map((s, i) => (
                <li key={s.title} style={rise(i + 1)} className="grid animate-fade-up grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-muted font-bold text-foreground" aria-hidden="true">
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
              <Link href="/my" className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline">
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
              <p className="mt-3 text-sm text-muted-foreground">No feedback submitted yet. Anything you send will appear here with its progress.</p>
            )}
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
                    <span className="shrink-0 text-sm">{r.status_text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" /> Visible only to the Digital Team
          </span>
          <span className="inline-flex items-center gap-2">
            <Users className="size-4" aria-hidden="true" /> Every item has an owner and an approver
          </span>
          <span className="inline-flex items-center gap-2">
            <Link2 className="size-4" aria-hidden="true" /> Every item has a reference and a tracker
          </span>
        </div>
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
