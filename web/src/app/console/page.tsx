"use client";

import { Columns3, LayoutGrid, List, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge, WorkTypeBadge } from "@/components/badges";
import { ActionDialog, type ActionResult } from "@/components/console/action-dialogs";
import { BoardView } from "@/components/console/board-view";
import { ItemPanel } from "@/components/console/item-panel";
import { WorkCard } from "@/components/console/work-card";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorText, type Board, type ConsoleView, type ItemList, type Project, type Staff } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, WORK_TYPES, WORK_TYPE_LABEL, age, day } from "@/lib/format";
import { cn } from "@/lib/utils";

const INBOXES = [
  { key: "mine", label: "Assigned to me" },
  { key: "needs_review", label: "Unassigned / needs review" },
  { key: "open", label: "All open" },
  { key: "overdue", label: "Overdue" },
  { key: "closed", label: "Closed" },
];
const FILTERS = ["project", "category", "priority", "work_type", "assignee", "q"] as const;
const VIEWS: { key: ConsoleView; label: string; icon: typeof List }[] = [
  { key: "board", label: "Board", icon: Columns3 },
  { key: "list", label: "List", icon: List },
  { key: "cards", label: "Cards", icon: LayoutGrid },
];

function Work() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<ConsoleView | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [list, setList] = useState<ItemList | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [pendingMove, setPendingMove] = useState<{ ref: string; column: "resolved" | "closed" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inbox = params.get("inbox") ?? "mine";
  const item = params.get("item");
  const query = new URLSearchParams();
  query.set("inbox", inbox);
  for (const f of FILTERS) if (params.get(f)) query.set(f, params.get(f) as string);
  const queryString = query.toString();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(() => undefined);
    api.get<Staff[]>("/admin/digital-staff").then(setStaff).catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const current = view ?? "board";
    if (current === "board") {
      api
        .get<Board>(`/console/board?${queryString}`)
        .then((b) => {
          setError(null);
          setBoard(b);
          setView((v) => v ?? b.view);
        })
        .catch((e: unknown) => setError(errorText(e)));
    } else {
      api
        .get<ItemList>(`/console/items?${queryString}&sort=${current === "cards" ? "urgent" : "newest"}`)
        .then((l) => {
          setError(null);
          setList(l);
        })
        .catch((e: unknown) => setError(errorText(e)));
    }
  }, [queryString, view]);

  useEffect(load, [load]);

  async function changeView(v: ConsoleView) {
    setView(v);
    await api.put("/console/view", { view: v }).catch(() => undefined);
  }

  async function move(ref: string, column: string) {
    if (column === "resolved" || column === "closed") {
      setPendingMove({ ref, column });
      return;
    }
    try {
      await api.post(`/console/items/${ref}/move`, { column });
      toast.success(column === "approved" ? `${ref} approved` : `${ref} moved to In progress`);
    } catch (e) {
      toast.error(errorText(e));
    }
    load();
  }

  async function finishMove(_kind: string, r: ActionResult): Promise<boolean> {
    if (!pendingMove) return false;
    try {
      await api.post(`/console/items/${pendingMove.ref}/move`, { column: pendingMove.column, note: r.text });
      toast.success(`${pendingMove.ref} ${pendingMove.column}`);
      load();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }

  const effectiveView = view ?? board?.view ?? "board";
  const items = effectiveView === "board" ? null : list?.items;

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Work</h1>
          <p className="text-sm text-muted-foreground">
            {me.role === "admin" ? "Approve, assign and follow everything." : "Your items, and everything else the team is working on."}
          </p>
        </div>
        <div className="flex rounded-xl bg-muted p-1" role="group" aria-label="View">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant="ghost"
              aria-pressed={effectiveView === key}
              onClick={() => void changeView(key)}
              className={cn("h-9 rounded-lg px-3", effectiveView === key && "bg-card shadow-card hover:bg-card")}
            >
              <Icon /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Inbox">
        {INBOXES.map((b) => (
          <button
            key={b.key}
            role="tab"
            aria-selected={inbox === b.key}
            onClick={() => setParam("inbox", b.key)}
            className={cn(
              "min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold text-muted-foreground hover:bg-muted",
              inbox === b.key && "bg-band text-band-foreground hover:bg-band",
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <form
          className="relative sm:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", search.trim() || null);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, summary, FB number, person" aria-label="Search" className="h-10 rounded-xl pl-9" />
        </form>
        <FilterSelect label="Project" all="All projects" value={params.get("project")} options={projects.map((p) => [p.slug, p.name])} onChange={(v) => setParam("project", v)} />
        <FilterSelect label="Work type" all="All work types" value={params.get("work_type")} options={WORK_TYPES.map((w) => [w, WORK_TYPE_LABEL[w]])} onChange={(v) => setParam("work_type", v)} />
        <FilterSelect label="Category" all="All categories" value={params.get("category")} options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])} onChange={(v) => setParam("category", v)} />
        <FilterSelect label="Priority" all="All priorities" value={params.get("priority")} options={PRIORITIES.map((p) => [p, p])} onChange={(v) => setParam("priority", v)} />
      </div>

      {error && <p className="text-destructive" role="alert">{error}</p>}

      {effectiveView === "board" &&
        (board ? (
          <BoardView columns={board.columns} onOpen={(r) => setParam("item", r)} onMove={(r, c) => void move(r, c)} />
        ) : (
          <div className="flex gap-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72 w-[290px] shrink-0 rounded-3xl" />
            ))}
          </div>
        ))}

      {effectiveView === "cards" && (
        <div className="mx-auto grid w-full max-w-xl gap-2">
          {items?.length === 0 && <Empty />}
          {items?.map((c) => (
            <WorkCard key={c.reference} card={c} showStatus onOpen={() => setParam("item", c.reference)} />
          ))}
        </div>
      )}

      {effectiveView === "list" && (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
          {items?.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Expected by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((c) => (
                  <TableRow key={c.reference} className="cursor-pointer" onClick={() => setParam("item", c.reference)}>
                    <TableCell className="font-mono text-xs font-semibold text-brand-text">
                      <button type="button" className="rounded" onClick={() => setParam("item", c.reference)}>
                        {c.reference}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-72 truncate font-medium">{c.title}</TableCell>
                    <TableCell>{c.project?.name ?? "–"}</TableCell>
                    <TableCell>
                      <WorkTypeBadge workType={c.work_type} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge showCode priority={c.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>{c.assignee?.name ?? "Unassigned"}</TableCell>
                    <TableCell className="font-mono text-xs tabular">{age(c.created_at)}</TableCell>
                    <TableCell className={cn(c.overdue && "font-semibold text-destructive")}>{c.expected_by ? day(c.expected_by) : "–"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {list && list.total > list.page_size && <p className="border-t p-3 text-sm text-muted-foreground">Showing {list.items.length} of {list.total}. Narrow the filters to see more.</p>}
        </div>
      )}

      <ItemPanel key={item ?? "none"} reference={item} projects={projects} staff={staff} onClose={() => setParam("item", null)} onChanged={load} />
      <ActionDialog kind={pendingMove ? (pendingMove.column === "resolved" ? "resolve" : "close") : null} onClose={() => setPendingMove(null)} onSubmit={finishMove} />
    </div>
  );
}

function Empty() {
  return <p className="p-10 text-center text-sm text-muted-foreground">No items in this view. New feedback appears here as soon as it is routed.</p>;
}

function FilterSelect({ label, all, value, options, onChange }: { label: string; all: string; value: string | null; options: [string, string][]; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
      <SelectTrigger className="h-10 w-full rounded-xl" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{all}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function WorkPage() {
  return (
    <Suspense>
      <Work />
    </Suspense>
  );
}
