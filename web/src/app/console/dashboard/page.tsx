"use client";

import { Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Flow, Sparkline, Stuck } from "@/components/console/dashboard-charts";
import { Team, Tools } from "@/components/console/dashboard-tables";
import { useMe } from "@/components/me";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorText, type Dashboard, type DashboardFigure, type DashboardRate, type UsageSummary } from "@/lib/api";
import { day } from "@/lib/format";

/** A duration in the unit a person reads easily: hours under two days, then days. */
const duration = (h: number) => (h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h / 2.4) / 10} days`);
const asPercent = (r: number) => `${Math.round(r * 100)}%`;

type Change = { text: string; up: boolean | null; good: boolean | null };

/** How a figure moved against the period before, and whether that is good news. */
function change(f: DashboardFigure, lowerIsBetter: boolean, amount: (d: number) => string, [more, less]: [string, string], since: string): Change | null {
  if (f.value === null || f.previous === null) return null;
  const d = f.value - f.previous;
  if (amount(Math.abs(d)) === amount(0)) return { text: `Same as ${since}`, up: null, good: null };
  return { text: `${amount(Math.abs(d))} ${d > 0 ? more : less} than ${since}`, up: d > 0, good: d > 0 !== lowerIsBetter };
}

function Tile({ label, value, delta, note, trend }: { label: string; value: string; delta: Change | null; note: string; trend: (number | null)[] }) {
  const Icon = delta?.up === null ? Minus : delta?.up ? TrendingUp : TrendingDown;
  const tone = delta?.good === null ? "text-muted-foreground" : delta?.good ? "font-semibold text-success" : "font-semibold text-warning";
  return (
    <div className="flex flex-col rounded-3xl border bg-card p-5 shadow-card">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {delta && (
        <p className={`mt-1 flex items-center gap-1 text-sm ${tone}`}>
          <Icon className="size-4 shrink-0" aria-hidden="true" /> {delta.text}
        </p>
      )}
      <p className="mt-1 mb-3 text-sm text-muted-foreground">{note}</p>
      <Sparkline values={trend} />
    </div>
  );
}

function Rate({ label, r, of, target }: { label: string; r: DashboardRate; of: string; target?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{r.rate === null ? "–" : asPercent(r.rate)}</dd>
      <dd className="text-xs text-muted-foreground">
        {r.count} of {r.of} {of}
        {target && ` · Target: ${target}`}
      </dd>
    </div>
  );
}

/** Reopens, duplicates, routing corrections and thanks in the period: signs of how well the work lands. */
function Quality({ q, weeks }: { q: Dashboard["quality"]; weeks: number }) {
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="quality">
      <h2 id="quality" className="font-bold">
        Quality
      </h2>
      <p className="text-sm text-muted-foreground">In the last {weeks} weeks</p>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Rate label="Reopened" r={q.reopened} of="resolutions" />
        <Rate label="Duplicates" r={q.duplicates} of="received" />
        <Rate label="Routing corrections" r={q.corrections} of="from the chat" target="10% or less" />
        <div>
          <dt className="text-sm text-muted-foreground">👍 Thanks</dt>
          <dd className="mt-1 text-xl font-bold">{q.thanks}</dd>
          <dd className="text-xs text-muted-foreground">on Fixes and updates</dd>
        </div>
      </dl>
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

/** The manager dashboard (D112, Admins only): headline figures against the period before, flow, where
 * items are stuck, tools and team, quality, and AI usage. */
export default function DashboardPage() {
  const me = useMe();
  const admin = me.role === "admin";
  const [weeks, setWeeks] = useState(4);
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    if (admin) api.get<Dashboard>(`/console/dashboard?weeks=${weeks}`).then(setD).catch((e: unknown) => setError(errorText(e)));
  }, [admin, weeks]);
  useEffect(() => {
    if (admin) api.get<UsageSummary>("/console/usage").then(setUsage).catch(() => undefined);
  }, [admin]);

  if (!admin) return <p className="p-6 text-muted-foreground">The dashboard is for Admins.</p>;
  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!d) return <Skeleton className="m-6 h-96 rounded-3xl" />;
  const before = `the ${d.weeks} weeks before`;
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <ToggleGroup type="single" value={String(weeks)} onValueChange={(v) => v && setWeeks(Number(v))} variant="outline" spacing={0} aria-label="Period">
          {[4, 12].map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="h-9 px-4">
              Last {n} weeks
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {/* The last answer stays, dimmed, while another period loads. */}
      <div className={`grid grid-cols-1 gap-4 transition-opacity ${d.weeks === weeks ? "" : "opacity-60"}`} aria-busy={d.weeks !== weeks}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Open backlog"
            value={String(d.backlog.value)}
            delta={change(d.backlog, true, String, ["more", "fewer"], `${d.weeks} weeks ago`)}
            note="New to In progress, not yet resolved"
            trend={d.backlog.trend}
          />
          <Tile
            label="Median time to first response"
            value={d.first_response_hours.value === null ? "–" : duration(d.first_response_hours.value)}
            delta={change(d.first_response_hours, true, duration, ["slower", "faster"], before)}
            note="Target: under 2 business days"
            trend={d.first_response_hours.trend}
          />
          <Tile
            label="Median time to resolve"
            value={d.resolve_days.value === null ? "–" : duration(d.resolve_days.value * 24)}
            delta={change(d.resolve_days, true, (n) => duration(n * 24), ["slower", "faster"], before)}
            note={`${d.resolve_days.count} resolved`}
            trend={d.resolve_days.trend}
          />
          <Tile
            label="On time"
            value={d.on_time.value === null ? "–" : asPercent(d.on_time.value)}
            delta={change(d.on_time, false, (n) => `${Math.round(n * 100)} points`, ["higher", "lower"], before)}
            note={`Resolved by the due date, of ${d.on_time.count} with one`}
            trend={d.on_time.trend}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Flow flow={d.flow} weeks={d.weeks} />
          <Stuck stuck={d.stuck} approvalsLate={d.approvals_over_2_days} />
        </div>
        <Tools rows={d.tools} weeks={d.weeks} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Team rows={d.team} />
          <Quality q={d.quality} weeks={d.weeks} />
        </div>
      </div>
      {usage && <AiUsage u={usage} />}
    </div>
  );
}
