"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Dashboard } from "@/lib/api";
import { STATUS_LABEL, day } from "@/lib/format";

/** Below this many items a chart says so and shows the plain counts instead (D112). */
export const ENOUGH = 10;

export const AGE_BANDS = ["Under 2 days", "2 to 7 days", "1 to 4 weeks", "Over 4 weeks"];
const AGE_CLASS = ["bg-age-1", "bg-age-2", "bg-age-3", "bg-age-4"];

/** "6 Oct" from a week's Monday. */
const short = (week: string) => day(week).split(" ").slice(1).join(" ");

/** A clean top for a count axis, with a whole-number halfway tick. */
function niceTop(max: number): number {
  const raw = Math.max(4, max);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const top = m * mag;
    if (top >= raw && Number.isInteger(top / 2)) return top;
  }
  return 10 * mag;
}

/** A small trend under a headline figure: weeks in the quiet gray, this week's point in the accent. Gaps where a week has no value. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const lo = Math.min(...known);
  const span = Math.max(...known) - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 90 - ((v - lo) / span) * 80;
  const runs: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) runs.push(run.join(" "));
      run = [];
    } else run.push(`${x(i)},${y(v)}`);
  });
  if (run.length > 1) runs.push(run.join(" "));
  const last = values.length - 1;
  const end = values[last];
  return (
    <div className="relative mt-auto h-8" aria-hidden="true">
      <svg className="size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {runs.map((points) => (
          <polyline key={points} points={points} fill="none" stroke="var(--input)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {end !== null && (
        <span className="absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-series-1 ring-2 ring-card" style={{ left: `${x(last)}%`, bottom: `${100 - y(end)}%` }} />
      )}
    </div>
  );
}

function Legend({ items }: { items: { label: string; className: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {items.map((s) => (
        <li key={s.label} className="inline-flex items-center gap-1.5">
          <span className={s.line ? `h-0.5 w-4 rounded-full ${s.className}` : `size-3 rounded-sm ${s.className}`} aria-hidden="true" /> {s.label}
        </li>
      ))}
    </ul>
  );
}

function Card({ id, title, note, table, onTable, children }: { id: string; title: string; note?: string; table?: boolean; onTable?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby={id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="font-bold">
            {title}
          </h2>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        {onTable && (
          <Button variant="ghost" size="sm" onClick={onTable} aria-pressed={table}>
            {table ? "Show chart" : "Show table"}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function NotEnough({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm">
      <p className="font-semibold">Not enough data yet</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

const FLOW = [
  { key: "received" as const, label: "Received", className: "bg-series-1" },
  { key: "resolved" as const, label: "Resolved", className: "bg-series-2" },
];

/** Received and resolved each week as bars, and the open backlog at each week's end as a line, on one count axis. */
export function Flow({ flow, weeks }: { flow: Dashboard["flow"]; weeks: number }) {
  const [table, setTable] = useState(false);
  const received = flow.reduce((n, w) => n + w.received, 0);
  const resolved = flow.reduce((n, w) => n + w.resolved, 0);
  const open = flow.at(-1)?.backlog ?? 0;
  const enough = received >= ENOUGH;
  const top = niceTop(Math.max(...flow.flatMap((w) => [w.received, w.resolved, w.backlog])));
  const pct = (v: number) => (v / top) * 100;
  const n = flow.length;
  return (
    <Card id="flow" title="Flow" note={`Received and resolved each week, and the open backlog, over the last ${weeks} weeks`} table={table} onTable={enough ? () => setTable((t) => !t) : undefined}>
      {!enough ? (
        <NotEnough>
          {received} received and {resolved} resolved in the last {weeks} weeks; {open} open now.
        </NotEnough>
      ) : table ? (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Week starting</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
              <TableHead className="text-right">Open at week end</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flow.map((w) => (
              <TableRow key={w.week}>
                <TableCell>{day(w.week)}</TableCell>
                <TableCell className="text-right font-mono tabular">{w.received}</TableCell>
                <TableCell className="text-right font-mono tabular">{w.resolved}</TableCell>
                <TableCell className="text-right font-mono tabular">{w.backlog}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <>
          <div className="mt-3">
            <Legend items={[...FLOW, { label: "Open backlog", className: "bg-series-3", line: true }]} />
          </div>
          <div className="mt-4 grid grid-cols-[2rem_1fr] gap-x-2">
            <div className="relative h-44 text-right font-mono text-[11px] text-muted-foreground tabular" aria-hidden="true">
              {[0, top / 2, top].map((t) => (
                <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${pct(t)}%` }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="relative h-44">
              {[top / 2, top].map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${pct(t)}%` }} aria-hidden="true" />
              ))}
              <div className="absolute inset-x-0 bottom-0 border-t border-input" aria-hidden="true" />
              <div role="group" aria-label={`Flow for the last ${weeks} weeks; use Show table for the numbers`} className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                {flow.map((w) => (
                  <Tooltip key={w.week}>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        aria-label={`Week of ${day(w.week)}: ${w.received} received, ${w.resolved} resolved, ${w.backlog} open at the end`}
                        className="flex h-full items-end justify-center gap-[2px] rounded-md px-0.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {FLOW.map((s) => (
                          <span key={s.key} className={`w-full max-w-6 rounded-t-[4px] ${s.className}`} style={{ height: `${pct(w[s.key])}%`, minHeight: w[s.key] ? 2 : 0 }} />
                        ))}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-semibold">Week of {day(w.week)}</p>
                      {[...FLOW, { key: "backlog" as const, label: "Open at week end", className: "bg-series-3" }].map((s) => (
                        <p key={s.key} className="flex items-center gap-2">
                          <span className={`h-0.5 w-3 rounded-full ${s.className}`} aria-hidden="true" />
                          <strong className="font-mono tabular">{w[s.key]}</strong> {s.label.toLowerCase()}
                        </p>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={flow.map((w, i) => `${i + 0.5},${100 - pct(w.backlog)}`).join(" ")}
                  fill="none"
                  stroke="var(--series-3)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {flow.map((w, i) => (
                <span
                  key={w.week}
                  className="pointer-events-none absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-series-3 ring-2 ring-card"
                  style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${pct(w.backlog)}%` }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <div />
            <div className="mt-1.5 grid text-center text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
              {flow.map((w, i) => (
                // Every other date on narrow screens when there are many weeks, so the dates never overlap.
                <span key={w.week} className={n > 6 && i % 2 ? "hidden sm:block" : undefined}>
                  {short(w.week)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/** Open items by stage, each split by how long it has sat in that stage. */
export function Stuck({ stuck, approvalsLate }: { stuck: Dashboard["stuck"]; approvalsLate: number }) {
  const [table, setTable] = useState(false);
  const rows = stuck.map((r) => ({ ...r, total: r.bands.reduce((a, b) => a + b, 0) }));
  const open = rows.reduce((n, r) => n + r.total, 0);
  const enough = open >= ENOUGH;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card id="stuck" title="Where it's stuck" note="Open items by stage and how long they have been in it" table={table} onTable={enough ? () => setTable((t) => !t) : undefined}>
      {!enough ? (
        <NotEnough>{rows.map((r) => `${STATUS_LABEL[r.stage]} ${r.total}`).join(" · ")}</NotEnough>
      ) : table ? (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              {AGE_BANDS.map((b) => (
                <TableHead key={b} className="text-right">
                  {b}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.stage}>
                <TableCell>{STATUS_LABEL[r.stage]}</TableCell>
                {r.bands.map((n, i) => (
                  <TableCell key={AGE_BANDS[i]} className="text-right font-mono tabular">
                    {n}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono font-semibold tabular">{r.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <>
          <div className="mt-3">
            <Legend items={AGE_BANDS.map((label, i) => ({ label, className: AGE_CLASS[i] }))} />
          </div>
          <ul className="mt-4 grid gap-1" aria-label="Open items by stage; use Show table for the numbers">
            {rows.map((r) => (
              <Tooltip key={r.stage}>
                <TooltipTrigger asChild>
                  <li
                    tabIndex={0}
                    aria-label={`${STATUS_LABEL[r.stage]}: ${r.total} open; ${r.bands.map((n, i) => `${n} ${AGE_BANDS[i].toLowerCase()}`).join(", ")}`}
                    className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 rounded-md px-1 py-1 text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate">{STATUS_LABEL[r.stage]}</span>
                    <span className="flex h-5 gap-[2px]" aria-hidden="true">
                      {r.bands.map((n, i) =>
                        n ? <span key={AGE_BANDS[i]} className={`h-full last:rounded-r-[4px] ${AGE_CLASS[i]}`} style={{ width: `${(n / max) * 100}%` }} /> : null,
                      )}
                    </span>
                    <span className="text-right font-mono tabular">{r.total}</span>
                  </li>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">{STATUS_LABEL[r.stage]}</p>
                  {r.bands.map((n, i) => (
                    <p key={AGE_BANDS[i]} className="flex items-center gap-2">
                      <span className={`h-0.5 w-3 rounded-full ${AGE_CLASS[i]}`} aria-hidden="true" />
                      <strong className="font-mono tabular">{n}</strong> {AGE_BANDS[i].toLowerCase()}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            ))}
          </ul>
        </>
      )}
      {approvalsLate > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-warning">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {approvalsLate} waiting for approval over 2 business days
        </p>
      )}
    </Card>
  );
}
