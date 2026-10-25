"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Project } from "@/lib/api";

const GROUPS: Record<Project["project_group"], string> = { platforms: "Platforms", agents: "Agents", other: "Other" };

/** One private channel per project (brief §4.7). */
export default function ChannelsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch((e: unknown) => setError(errorText(e)));
  }, []);

  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-extrabold">Channels</h1>
        <p className="text-sm text-muted-foreground">Team chat for each tool, outside any single feedback item. Notes on one item belong on that item.</p>
        <p className="text-sm text-muted-foreground">Private to the Digital team. Staff never see these.</p>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!projects && !error && <Skeleton className="h-60 rounded-3xl" />}
      {(["platforms", "agents", "other"] as const).map((g) => {
        const list = projects?.filter((p) => p.project_group === g) ?? [];
        if (!list.length) return null;
        return (
          <section key={g} aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="mb-2 text-sm font-semibold text-muted-foreground">
              {GROUPS[g]}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {list.map((p) => (
                <li key={p.slug}>
                  <Link href={`/console/channels/${p.slug}`} className="flex min-h-12 items-center gap-3 rounded-2xl border bg-card px-4 shadow-card hover:bg-muted/50">
                    <span className="font-semibold">{p.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
