"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorText, type Category, type Dashboard, type UsageSummary, type WorkType } from "@/lib/api";
import { CATEGORY_LABEL, WORK_TYPE_LABEL, day } from "@/lib/format";

function Stat({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-3xl border bg-card p-5 shadow-card">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
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

const aud = (n: number) => `A$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Spend against a budget, as a meter with the numbers in words. */
function Budget({ label, spent, budget }: { label: string; spent: number; budget: number }) {
  const percent = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const high = percent >= 80;
  return (
    <div className="grid gap-1.5">
      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono tabular">
          {aud(spent)} {budget ? `of ${aud(budget)}` : "(no limit)"}
        </span>
      </p>
      {budget > 0 && (
        <>
          <div role="meter" aria-label={`${label} spend`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${high ? "bg-warning" : "bg-series-1"}`} style={{ width: `${percent}%` }} />
          </div>
          {high && (
            <p className="flex items-center gap-1 text-xs font-semibold text-warning">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {percent}% used{percent >= 100 ? ". New chats are going to the backup form." : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** AI usage (D36): model spend against the daily and monthly budgets, and who is using it (Admins). */
function AiUsage({ u }: { u: UsageSummary }) {
  const max = Math.max(0.0001, ...u.history.map((h) => h.cost_aud));
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="ai-usage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ai-usage" className="font-bold">
          AI usage
        </h2>
        <p className="text-xs text-muted-foreground">Estimated from Gemini token counts. Per-person limit: {tokens(u.daily_tokens_per_user)} tokens a day.</p>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Budget label="Today" spent={u.today.cost_aud} budget={u.daily_budget_aud} />
        <Budget label="This month" spent={u.month.cost_aud} budget={u.monthly_budget_aud} />
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Model calls today</dt>
          <dd className="font-mono text-xl font-bold tabular">{u.today.calls}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tokens today</dt>
          <dd className="font-mono text-xl font-bold tabular">{tokens(u.today.tokens)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cost per item (30 days)</dt>
          <dd className="font-mono text-xl font-bold tabular">{u.avg_cost_per_item_aud === null ? "–" : aud(u.avg_cost_per_item_aud)}</dd>
          <dd className="text-xs text-muted-foreground">Target: under A$0.05</dd>
        </div>
      </dl>
      <h3 className="mt-6 text-sm font-semibold text-muted-foreground">Last 14 days</h3>
      <div className="mt-2 grid grid-cols-14 items-end gap-1" role="img" aria-label={`Daily AI spend for the last 14 days, highest ${aud(max)}`}>
        {u.history.map((h) => (
          <Tooltip key={h.day}>
            <TooltipTrigger asChild>
              <div className="flex h-20 items-end rounded-sm hover:bg-muted/60">
                <span className="w-full rounded-t-[3px] bg-series-1" style={{ height: `${(h.cost_aud / max) * 100}%`, minHeight: h.calls ? 2 : 0 }} />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {day(h.day)}: {aud(h.cost_aud)}, {tokens(h.tokens)} tokens, {h.calls} calls
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {u.people.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-muted-foreground">Top users today</h3>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {u.people.map((p) => (
                <TableRow key={p.email}>
                  <TableCell>
                    <span className="font-medium">{p.name}</span>
                    {p.limit_reached && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                        <TriangleAlert className="size-3" aria-hidden="true" /> Limit reached
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular">{tokens(p.tokens)}</TableCell>
                  <TableCell className="text-right font-mono tabular">{aud(p.cost_aud)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}

/** Dashboard (brief §4.4.6): open items, weekly trend, time to first response, approvals waiting. */
export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    api.get<Dashboard>("/console/dashboard").then(setD).catch((e: unknown) => setError(errorText(e)));
    api.get<UsageSummary>("/console/usage").then(setUsage).catch(() => undefined);
  }, []);

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!d) return <Skeleton className="m-6 h-96 rounded-3xl" />;
  const open = d.open_by_project.reduce((n, r) => n + r.count, 0);
  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-extrabold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open items" value={String(open)} />
        <Stat
          label="Waiting for approval"
          value={String(d.approvals_waiting)}
          note={d.approvals_over_2_days ? `${d.approvals_over_2_days} over 2 business days` : undefined}
          warn={d.approvals_over_2_days > 0}
        />
        <Stat label="Avg time to first response" value={d.avg_first_response_hours === null ? "–" : `${d.avg_first_response_hours} h`} note="Target: under 2 business days" />
        <Stat
          label="Project reassignment rate"
          value={d.project_reassignment_rate === null ? "–" : `${Math.round(d.project_reassignment_rate * 100)}%`}
          note="Target: 10% or less (90% correct)"
        />
      </div>
      {usage && <AiUsage u={usage} />}
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
