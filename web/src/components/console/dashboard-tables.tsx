"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Dashboard } from "@/lib/api";

type Row = Record<string, string | number | null>;
type Column<T extends Row> = { key: keyof T & string; label: string; numeric?: boolean; show?: (row: T) => React.ReactNode };

const days = (n: number | null) => (n === null ? "–" : `${n} d`);

/** A table sorted by any column header (numbers largest first on the first click); a row opens Work filtered to it. */
function SortTable<T extends Row>({ id, title, note, columns, rows, href, initial }: { id: string; title: string; note: string; columns: Column<T>[]; rows: T[]; href: (row: T) => string | null; initial: keyof T & string }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: keyof T & string; down: boolean }>({ key: initial, down: true });
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort.key] ?? -1;
    const y = b[sort.key] ?? -1;
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.down ? -order : order;
  });
  const [first, ...rest] = columns;
  return (
    <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby={id}>
      <h2 id={id} className="font-bold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{note}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort.key === c.key;
                const Arrow = sort.down ? ArrowDown : ArrowUp;
                return (
                  <TableHead key={c.key} className={c.numeric ? "text-right" : undefined} aria-sort={active ? (sort.down ? "descending" : "ascending") : undefined}>
                    <button
                      type="button"
                      className={`inline-flex min-h-8 items-center gap-1 font-semibold hover:text-foreground ${c.numeric ? "flex-row-reverse" : ""}`}
                      onClick={() => setSort({ key: c.key, down: active ? !sort.down : Boolean(c.numeric) })}
                    >
                      {c.label}
                      <Arrow className={`size-3.5 ${active ? "" : "invisible"}`} aria-hidden="true" />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const to = href(row);
              return (
                <TableRow
                  key={String(row[first.key])}
                  className={to ? "cursor-pointer" : undefined}
                  onClick={(e) => {
                    if (to && !(e.target as HTMLElement).closest("a")) router.push(to);
                  }}
                >
                  <TableCell className="font-medium">
                    {to ? (
                      <Link href={to} className="hover:underline">
                        {row[first.key]}
                      </Link>
                    ) : (
                      row[first.key]
                    )}
                  </TableCell>
                  {rest.map((c) => (
                    <TableCell key={c.key} className={c.numeric ? "text-right font-mono tabular" : undefined}>
                      {c.show ? c.show(row) : row[c.key]}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

type Tool = Dashboard["tools"][number];
type Person = Dashboard["team"][number];

/** Per tool: what came in, what is open and how old, what came back, what was resolved and thanked. */
export function Tools({ rows, weeks }: { rows: Tool[]; weeks: number }) {
  return (
    <SortTable<Tool>
      id="tools"
      title="Tools"
      note={`New, reopened, resolved and 👍 Thanks in the last ${weeks} weeks; open and oldest now`}
      initial="open"
      rows={rows}
      href={(r) => (r.slug ? `/console?inbox=open&project=${r.slug}` : null)}
      columns={[
        { key: "name", label: "Tool" },
        { key: "new", label: "New", numeric: true },
        { key: "open", label: "Open", numeric: true },
        { key: "oldest_days", label: "Oldest", numeric: true, show: (r) => days(r.oldest_days) },
        { key: "reopened", label: "Reopened", numeric: true },
        { key: "resolved", label: "Resolved", numeric: true },
        { key: "thanks", label: "👍 Thanks", numeric: true },
      ]}
    />
  );
}

/** Per person: open items, how many are past their due date, and the oldest. */
export function Team({ rows }: { rows: Person[] }) {
  return (
    <SortTable<Person>
      id="team"
      title="Team"
      note="Open items now, those past their due date, and the oldest"
      initial="open"
      rows={rows}
      href={(r) => `/console?inbox=open&assignee=${r.id}`}
      columns={[
        { key: "name", label: "Person" },
        { key: "open", label: "Open", numeric: true },
        { key: "overdue", label: "Overdue", numeric: true, show: (r) => (r.overdue ? <span className="font-semibold text-warning">{r.overdue}</span> : 0) },
        { key: "oldest_days", label: "Oldest", numeric: true, show: (r) => days(r.oldest_days) },
      ]}
    />
  );
}
