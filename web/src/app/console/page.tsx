"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge } from "@/components/badges";
import { ActionDialog, type ActionResult } from "@/components/console/action-dialogs";
import { BoardView } from "@/components/console/board-view";
import { useCounts } from "@/components/console/counts";
import { FilterMenu, type FilterField } from "@/components/console/filter-menu";
import { ItemPanel } from "@/components/console/item-panel";
import { useMe } from "@/components/me";
import { RowActions } from "@/components/console/row-actions";
import { WorkCard } from "@/components/console/work-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorText, type Board, type Card, type ConsoleView, type ItemList, type Project, type Staff, type Status } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, WORK_TYPES, WORK_TYPE_LABEL, age, day } from "@/lib/format";
import { defaultInbox } from "@/lib/inbox";
import { cn } from "@/lib/utils";

const INBOXES = [
  { key: "mine", label: "Assigned to me" },
  { key: "needs_review", label: "Unassigned / needs review" },
  { key: "open", label: "All open" },
  { key: "overdue", label: "Overdue" },
  { key: "closed", label: "Closed" },
] as const;
const INBOX_EMPTY: Record<string, string> = {
  mine: "Nothing is assigned to you.",
  needs_review: "All caught up. Nothing is waiting to be looked at.",
  open: "Nothing is open right now.",
  overdue: "Nothing is overdue.",
  closed: "Nothing has been closed yet.",
};
const FILTERS = ["project", "category", "priority", "work_type", "assignee", "q"] as const;
const VIEWS: { key: ConsoleView; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "list", label: "List" },
  { key: "cards", label: "Cards" },
];

/** The list groups by stage in the board's order, so the list and the board read the same way. */
const GROUPS: { title: string; statuses: Status[] }[] = [
  { title: "Needs review", statuses: ["needs_review", "new"] },
  { title: "Awaiting approval", statuses: ["awaiting_approval"] },
  { title: "Approved", statuses: ["approved"] },
  { title: "In progress", statuses: ["in_progress"] },
  { title: "Resolved", statuses: ["resolved"] },
  { title: "Closed", statuses: ["acknowledged", "declined", "closed"] },
];

type Pending = { ref: string; kind: "resolve" | "close" | "update"; column?: "resolved" | "closed" };

function Work() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const { counts, refresh: refreshCounts } = useCounts();
  const [view, setView] = useState<ConsoleView | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [list, setList] = useState<ItemList | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupsFailed, setLookupsFailed] = useState(false);

  const inbox = params.get("inbox") ?? defaultInbox(me.role);
  const item = params.get("item");
  const page = Number(params.get("page") ?? "1") || 1;
  const query = new URLSearchParams();
  query.set("inbox", inbox);
  for (const f of FILTERS) if (params.get(f)) query.set(f, params.get(f) as string);
  const queryString = query.toString();

  /** Change several address parameters at once; a new filter or inbox goes back to the first page. */
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!("page" in patch) && !("item" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const setParam = useCallback((key: string, value: string | null) => setParams({ [key]: value }), [setParams]);

  const loadLookups = useCallback(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(() => setLookupsFailed(true));
    api.get<Staff[]>("/admin/digital-staff").then(setStaff).catch(() => setLookupsFailed(true));
  }, []);

  useEffect(loadLookups, [loadLookups]);

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
        .get<ItemList>(`/console/items?${queryString}&sort=${current === "cards" ? "urgent" : "newest"}&page=${page}`)
        .then((l) => {
          setError(null);
          setList(l);
        })
        .catch((e: unknown) => setError(errorText(e)));
    }
  }, [queryString, view, page]);

  useEffect(load, [load]);

  /** After a change: reload what is shown and the numbers beside it. */
  const reload = useCallback(() => {
    load();
    refreshCounts();
  }, [load, refreshCounts]);

  async function changeView(v: ConsoleView) {
    setView(v);
    await api.put("/console/view", { view: v }).catch(() => undefined);
  }

  async function move(ref: string, column: string) {
    if (column === "resolved" || column === "closed") {
      setPending({ ref, kind: column === "resolved" ? "resolve" : "close", column });
      return;
    }
    try {
      await api.post(`/console/items/${ref}/move`, { column });
      toast.success(column === "approved" ? `${ref} approved` : `${ref} moved to In progress`);
    } catch (e) {
      toast.error(errorText(e));
    }
    reload();
  }

  async function assign(ref: string, assigneeId: string | null) {
    try {
      await api.patch(`/console/items/${ref}`, { assignee_id: assigneeId });
      toast.success(assigneeId ? `${ref} assigned` : `${ref} unassigned`);
    } catch (e) {
      toast.error(errorText(e));
    }
    reload();
  }

  async function finishPending(_kind: string, r: ActionResult): Promise<boolean> {
    if (!pending) return false;
    try {
      if (pending.kind === "update") {
        await api.post(`/console/items/${pending.ref}/update`, { body: r.text, expected_by: r.expectedBy ?? null });
        toast.success("Saved");
      } else {
        await api.post(`/console/items/${pending.ref}/move`, { column: pending.column, note: r.text });
        toast.success(`${pending.ref} ${pending.column}`);
      }
      reload();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }

  const effectiveView = view ?? board?.view ?? "board";
  const items = effectiveView === "board" ? null : list?.items;
  const groups = useMemo(
    () => GROUPS.map((g) => ({ title: g.title, rows: (items ?? []).filter((c) => g.statuses.includes(c.status)) })).filter((g) => g.rows.length > 0),
    [items],
  );

  // The order the panel steps through with Previous and Next: the order on screen.
  const order = useMemo(() => {
    if (effectiveView === "board") return (board?.columns ?? []).flatMap((c) => c.items.map((i) => i.reference));
    if (effectiveView === "list") return groups.flatMap((g) => g.rows.map((r) => r.reference));
    return (items ?? []).map((i) => i.reference);
  }, [effectiveView, board, groups, items]);

  const filterFields: FilterField[] = [
    { param: "project", label: "Project", options: projects.map((p) => [p.slug, p.name]) },
    { param: "work_type", label: "Work type", options: WORK_TYPES.map((w) => [w, WORK_TYPE_LABEL[w]]) },
    { param: "category", label: "Category", options: CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]]) },
    { param: "priority", label: "Priority", options: PRIORITIES.map((p) => [p, p]) },
  ];
  const filterValues = Object.fromEntries(filterFields.map((f) => [f.param, params.get(f.param)]));
  const filtered = filterFields.some((f) => params.get(f.param)) || Boolean(params.get("q"));
  const emptyText = filtered ? "Nothing matches these filters. Remove one to see more." : (INBOX_EMPTY[inbox] ?? INBOX_EMPTY.open);

  const rowActions = (c: Card) => (
    <RowActions
      card={c}
      staff={staff}
      onOpen={() => setParam("item", c.reference)}
      onUpdate={() => setPending({ ref: c.reference, kind: "update" })}
      onAssign={(id) => void assign(c.reference, id)}
      onMove={(column) => void move(c.reference, column)}
    />
  );

  const position = item ? order.indexOf(item) : -1;

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Work</h1>
        <ToggleGroup type="single" value={effectiveView} onValueChange={(v) => v && void changeView(v as ConsoleView)} variant="outline" spacing={0} aria-label="View">
          {VIEWS.map(({ key, label }) => (
            <ToggleGroupItem key={key} value={key} className="h-9 px-4">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <Tabs value={inbox} onValueChange={(v) => setParam("inbox", v)}>
        <TabsList aria-label="Inbox" className="h-auto w-full justify-start gap-1 overflow-x-auto p-1">
          {INBOXES.map((b) => (
            <TabsTrigger key={b.key} value={b.key} className="h-9 flex-none px-4">
              {b.label}
              {counts && counts[b.key] > 0 && (
                <>
                  <span aria-hidden="true" className="rounded-full bg-secondary px-1.5 font-mono text-xs tabular">
                    {counts[b.key]}
                  </span>
                  <span className="sr-only">, {counts[b.key]} items</span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative w-full sm:w-80"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", search.trim() || null);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, summary, FB number, person" aria-label="Search" className="h-10 rounded-xl pl-9" />
        </form>
        <FilterMenu fields={filterFields} values={filterValues} onChange={setParams} />
      </div>

      {lookupsFailed && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
          The Project filter and the assignee list did not load.
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => {
              setLookupsFailed(false);
              loadLookups();
            }}>
            Try again
          </Button>
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => {
                setError(null);
                load();
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

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
          {items?.length === 0 && <Empty text={emptyText} />}
          {items?.map((c) => (
            <WorkCard key={c.reference} card={c} showStatus onOpen={() => setParam("item", c.reference)} />
          ))}
        </div>
      )}

      {effectiveView === "list" && (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
          {!list && !error && (
            <div className="grid gap-2 p-3" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}
          {items?.length === 0 ? (
            <Empty text={emptyText} />
          ) : (
            items && (
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
                    <TableHead className="sticky right-0 bg-card">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <Fragment key={g.title}>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={10} className="py-1.5 text-xs font-semibold text-muted-foreground">
                          {g.title} <span className="font-mono tabular">{g.rows.length}</span>
                        </TableCell>
                      </TableRow>
                      {g.rows.map((c) => (
                        <TableRow key={c.reference} className="cursor-pointer" onClick={() => setParam("item", c.reference)}>
                          <TableCell className="font-mono text-xs font-semibold">
                            <button type="button" className="rounded" onClick={() => setParam("item", c.reference)}>
                              {c.reference}
                            </button>
                          </TableCell>
                          <TableCell className="max-w-60 truncate font-medium">{c.title}</TableCell>
                          <TableCell>{c.project?.name ?? "–"}</TableCell>
                          <TableCell>{c.work_type ? WORK_TYPE_LABEL[c.work_type] : "–"}</TableCell>
                          <TableCell>
                            <PriorityBadge showCode priority={c.priority} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={c.status} />
                          </TableCell>
                          <TableCell>{c.assignee?.name ?? "Unassigned"}</TableCell>
                          <TableCell className="font-mono text-xs tabular">{age(c.created_at)}</TableCell>
                          <TableCell className={cn(c.overdue && "font-semibold text-destructive")}>{c.expected_by ? day(c.expected_by) : "–"}</TableCell>
                          <TableCell className="sticky right-0 w-12 bg-card">{rowActions(c)}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )
          )}
          {list && list.total > list.page_size && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
              <span>
                Showing {(list.page - 1) * list.page_size + 1}–{(list.page - 1) * list.page_size + list.items.length} of {list.total}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" className="h-9 rounded-xl" disabled={list.page <= 1} onClick={() => setParam("page", list.page > 2 ? String(list.page - 1) : null)}>
                  Previous
                </Button>
                <Button variant="outline" className="h-9 rounded-xl" disabled={list.page * list.page_size >= list.total} onClick={() => setParam("page", String(list.page + 1))}>
                  Next
                </Button>
              </span>
            </nav>
          )}
        </div>
      )}

      <ItemPanel
        key={item ?? "none"}
        reference={item}
        projects={projects}
        staff={staff}
        previous={position > 0 ? order[position - 1] : null}
        next={position >= 0 && position < order.length - 1 ? order[position + 1] : null}
        onStep={(ref) => setParam("item", ref)}
        onClose={() => setParam("item", null)}
        onChanged={reload}
      />
      <ActionDialog key={`${pending?.ref}-${pending?.kind}`} kind={pending ? pending.kind : null} onClose={() => setPending(null)} onSubmit={finishPending} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-10 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function WorkPage() {
  return (
    <Suspense>
      <Work />
    </Suspense>
  );
}
