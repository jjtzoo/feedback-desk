"use client";

import { Clock3, Gavel, Inbox, Repeat2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorText, type Category, type Dashboard, type WorkType } from "@/lib/api";
import { CATEGORY_LABEL, WORK_TYPE_LABEL, day } from "@/lib/format";

function Stat({ icon: Icon, label, value, note, warn }: { icon: typeof Inbox; label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-3xl border bg-card p-5 shadow-card">
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" /> {label}
      </p>
      <p className="mt-2 font-mono text-3xl font-bold tabular">{value}</p>
      {note && (
        <p className={`mt-1 flex items-center gap-1 text-sm ${warn ? "font-semibold text-warning" : "text-muted-foreground"}`}>
          {warn && <TriangleAlert className="size-4" aria-hidden="true" />} {note}
        </p>
      )}
    </div>
  );
}

/** One-series ranked bars with direct value labels (no legend needed for one series). */
function BarList({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby={`bl-${title}`}>
      <h2 id={`bl-${title}`} className="font-bold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No open items.</p>
      ) : (
        <ul className="mt-4 grid gap-2.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-3 text-sm">
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block h-5 rounded-r-[4px] bg-muted" aria-hidden="true">
                    <span className="block h-full rounded-r-[4px] bg-series-1" style={{ width: `${(r.count / max) * 100}%` }} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {r.label}: {r.count} open
                </TooltipContent>
              </Tooltip>
              <span className="text-right font-mono tabular">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Received vs resolved per week: two series, legend + value labels, table view. */
function Weekly({ weeks }: { weeks: Dashboard["weekly"] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...weeks.flatMap((w) => [w.received, w.resolved]));
  const series = [
    { key: "received" as const, label: "Received", className: "bg-series-1" },
    { key: "resolved" as const, label: "Resolved", className: "bg-series-2" },
  ];
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card lg:col-span-2" aria-labelledby="weekly">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="weekly" className="font-bold">
          Weekly trend
        </h2>
        <div className="flex items-center gap-4 text-sm">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`size-3 rounded-sm ${s.className}`} aria-hidden="true" /> {s.label}
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? "Show chart" : "Show table"}
          </Button>
        </div>
      </div>
      {table ? (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Week starting</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((w) => (
              <TableRow key={w.week}>
                <TableCell>{day(w.week)}</TableCell>
                <TableCell className="text-right font-mono tabular">{w.received}</TableCell>
                <TableCell className="text-right font-mono tabular">{w.resolved}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="mt-4 grid grid-cols-8 items-end gap-2" role="img" aria-label="Received and resolved per week for the last 8 weeks; use Show table for the numbers">
          {weeks.map((w) => (
            <Tooltip key={w.week}>
              <TooltipTrigger asChild>
                <div className="grid gap-1.5 rounded-lg p-1 hover:bg-muted/60">
                  <div className="flex h-36 items-end justify-center gap-[2px]">
                    {series.map((s) => (
                      <div key={s.key} className="flex h-full w-full max-w-4 flex-col items-center justify-end gap-1">
                        <span className="font-mono text-[11px] text-muted-foreground tabular">{w[s.key] || ""}</span>
                        <span className={`w-full rounded-t-[4px] ${s.className}`} style={{ height: `${(w[s.key] / max) * 100}%`, minHeight: w[s.key] ? 2 : 0 }} />
                      </div>
                    ))}
                  </div>
                  <span className="text-center text-[11px] text-muted-foreground">{day(w.week).split(" ").slice(1).join(" ")}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Week of {day(w.week)}: {w.received} received, {w.resolved} resolved
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </section>
  );
}

/** Dashboard (brief §4.4.6): open items, weekly trend, time to first response, approvals waiting. */
export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Dashboard>("/console/dashboard").then(setD).catch((e: unknown) => setError(errorText(e)));
  }, []);

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!d) return <Skeleton className="m-6 h-96 rounded-3xl" />;
  const open = d.open_by_project.reduce((n, r) => n + r.count, 0);
  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Computed live from the feedback and its history.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Inbox} label="Open items" value={String(open)} />
        <Stat
          icon={Gavel}
          label="Waiting for approval"
          value={String(d.approvals_waiting)}
          note={d.approvals_over_2_days ? `${d.approvals_over_2_days} over 2 business days` : "None overdue"}
          warn={d.approvals_over_2_days > 0}
        />
        <Stat icon={Clock3} label="Avg time to first response" value={d.avg_first_response_hours === null ? "–" : `${d.avg_first_response_hours} h`} note="Target: under 2 business days" />
        <Stat
          icon={Repeat2}
          label="Project reassignment rate"
          value={d.project_reassignment_rate === null ? "–" : `${Math.round(d.project_reassignment_rate * 100)}%`}
          note="Target: 10% or less (90% correct)"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Weekly weeks={d.weekly} />
        <BarList title="Open by project" rows={d.open_by_project} />
        <BarList title="Open by assignee" rows={d.open_by_assignee} />
        <BarList title="Open by category" rows={d.open_by_category.map((r) => ({ ...r, label: CATEGORY_LABEL[r.label as Category] ?? r.label }))} />
        <BarList title="Open by work type" rows={d.open_by_work_type.map((r) => ({ ...r, label: WORK_TYPE_LABEL[r.label as WorkType] ?? r.label }))} />
      </div>
    </div>
  );
}
