"use client";

import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Release, type ReleaseItem } from "@/lib/api";
import { day } from "@/lib/format";

// A progress update isn't shipped yet, so it sits under In progress whatever its work type.
const SECTIONS: { key: string; title: string; match: (i: ReleaseItem) => boolean }[] = [
  ...([
    ["fix", "Fixed"],
    ["improvement", "Improved"],
    ["new_feature", "New"],
  ] as const).map(([key, title]) => ({ key, title, match: (i: ReleaseItem) => i.source_type !== "progress" && i.work_type === key })),
  { key: "progress", title: "In progress", match: (i) => i.source_type === "progress" },
];

/** Fixes and updates (brief §4.8.4, D46): published Friday releases per project, newest first, fixes first. */
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
      <h1 className="text-3xl font-extrabold">Fixes and updates</h1>
      <p className="mt-1 text-muted-foreground">Changes to our tools each week.</p>

      {projects.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tool">
          {[["all", "All tools"] as const, ...projects].map(([slug, name]) => (
            <button
              key={slug}
              type="button"
              aria-pressed={project === slug}
              onClick={() => setProject(slug)}
              className={`min-h-11 rounded-full px-3.5 text-sm font-medium ${project === slug ? "bg-foreground text-background" : "bg-secondary hover:bg-muted"}`}
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
            {SECTIONS.map(({ key, title, match }) => {
              const items = r.items.filter(match);
              if (!items.length) return null;
              return (
                <section key={key} className="mt-5">
                  <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
                  <ul className="mt-2 grid gap-3">
                    {items.map((i) => (
                      <li key={i.id} className="border-l-2 pl-4">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          {i.title}
                          {i.yours && (
                            <span className="text-xs font-normal text-muted-foreground">From your feedback</span>
                          )}
                        </p>
                        {i.body && <p className="text-sm text-muted-foreground">{i.body}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {r.items.some((i) => !SECTIONS.some((s) => s.match(i))) && (
              <ul className="mt-5 grid gap-2">
                {r.items
                  .filter((i) => !SECTIONS.some((s) => s.match(i)))
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
