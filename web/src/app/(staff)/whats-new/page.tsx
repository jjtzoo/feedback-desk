"use client";

import { Lightbulb, Sparkles, Star, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Release, type WorkType } from "@/lib/api";
import { day } from "@/lib/format";

const SECTIONS: { key: WorkType; title: string; icon: typeof Wrench }[] = [
  { key: "new_feature", title: "New", icon: Lightbulb },
  { key: "improvement", title: "Improved", icon: Sparkles },
  { key: "fix", title: "Fixed", icon: Wrench },
];

/** What's new (brief §4.8.4): published Friday releases per project, newest first. */
export default function WhatsNewPage() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string>("all");

  useEffect(() => {
    api.get<Release[]>("/whats-new").then(setReleases).catch((e: unknown) => setError(errorText(e)));
  }, []);

  const projects = useMemo(() => [...new Map((releases ?? []).map((r) => [r.project.slug, r.project.name])).entries()], [releases]);
  const shown = (releases ?? []).filter((r) => project === "all" || r.project.slug === project);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">What&apos;s new</h1>
      <p className="mt-1 text-muted-foreground">Changes to our tools each week, many of them from your feedback.</p>

      {projects.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tool">
          {[["all", "All tools"] as const, ...projects].map(([slug, name]) => (
            <button
              key={slug}
              type="button"
              aria-pressed={project === slug}
              onClick={() => setProject(slug)}
              className={`min-h-9 rounded-full px-3.5 text-sm font-medium ${project === slug ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-8 text-destructive" role="alert">{error}</p>}
      {!releases && !error && <Skeleton className="mt-8 h-48 rounded-3xl" aria-busy="true" />}
      {releases?.length === 0 && (
        <p className="mt-10 rounded-3xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing published yet. Each Friday the Digital team shares what changed.
        </p>
      )}

      <div className="mt-8 grid gap-6">
        {shown.map((r) => (
          <article key={r.id} className="rounded-3xl border bg-card p-6 shadow-card">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">{r.project.name}</h2>
              <p className="text-sm text-muted-foreground">Week ending {day(r.week_ending)}</p>
            </header>
            {SECTIONS.map(({ key, title, icon: Icon }) => {
              const items = r.items.filter((i) => i.work_type === key);
              if (!items.length) return null;
              return (
                <section key={key} className="mt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-text">
                    <Icon className="size-4" aria-hidden="true" /> {title}
                  </h3>
                  <ul className="mt-2 grid gap-3">
                    {items.map((i) => (
                      <li key={i.id} className="border-l-2 border-primary/30 pl-4">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          {i.title}
                          {i.yours && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-xs text-brand-text">
                              <Star className="size-3" aria-hidden="true" /> From your feedback
                            </span>
                          )}
                        </p>
                        {i.body && <p className="text-sm text-muted-foreground">{i.body}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {r.items.some((i) => !i.work_type) && (
              <ul className="mt-5 grid gap-2">
                {r.items
                  .filter((i) => !i.work_type)
                  .map((i) => (
                    <li key={i.id} className="text-sm">
                      <span className="font-semibold">{i.title}</span> {i.body}
                    </li>
                  ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
