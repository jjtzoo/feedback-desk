"use client";

import { ChevronDown, ChevronUp, CircleHelp, FileText, Lock, TrendingUp, Users } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge } from "@/components/badges";
import { ActionDialog, type ActionKind, type ActionResult } from "@/components/console/action-dialogs";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorText, type Detail, type Project, type Staff } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, WORK_TYPES, WORK_TYPE_LABEL, ago, day, fileSize, when } from "@/lib/format";
import { cn } from "@/lib/utils";

const BRIEF_ROWS: [keyof Detail["dev_brief"], string][] = [
  ["problem", "Problem"],
  ["steps", "Steps to reproduce"],
  ["expected", "Expected"],
  ["actual", "Actual"],
  ["who_needs_it", "Who needs it and why"],
  ["asking_for", "What they're asking for"],
  ["done_when", "Done when"],
  ["submitter_quote", "Submitter's words"],
];
const MESSAGE_LABEL: Record<string, string> = { chat: "Chat", reply: "Reply", note: "Internal note", progress: "Progress update", follow_up: "Follow-up" };

function percent(n: number | undefined) {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

/** The detail panel beside the board (brief §4.4): developer brief first, then everything else. */
export function ItemPanel({
  reference,
  projects,
  staff,
  previous,
  next,
  onStep,
  onClose,
  onChanged,
}: {
  reference: string | null;
  projects: Project[];
  staff: Staff[];
  previous: string | null;
  next: string | null;
  onStep: (reference: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = useMe();
  const [item, setItem] = useState<Detail | null>(null);
  const [dialog, setDialog] = useState<{ kind: ActionKind; text?: string } | null>(null);
  const [composer, setComposer] = useState<"reply" | "note">("reply");
  const [feedFilter, setFeedFilter] = useState<"all" | "messages" | "history">("all");
  const [justSent, setJustSent] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!reference) return;
    api
      .get<Detail>(`/console/items/${reference}`)
      .then(setItem)
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, [reference]);

  useEffect(load, [load]);

  async function act(path: string, body: unknown = {}, method: "post" | "patch" = "post"): Promise<boolean> {
    if (!reference) return false;
    setBusy(true);
    try {
      const updated = method === "patch" ? await api.patch<Detail>(`/console/items/${reference}`, body) : await api.post<Detail>(`/console/items/${reference}/${path}`, body);
      setItem(updated);
      onChanged();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onDialog(kind: ActionKind, r: ActionResult): Promise<boolean> {
    const ok = await (kind === "update"
      ? act("update", { body: r.text, expected_by: r.expectedBy ?? null })
      : kind === "resolve"
        ? act("resolve", { body: r.text })
        : kind === "fix"
          ? act("close", { ending: "fixed" })
          : kind === "close"
            ? act("close", { reason: r.text, ending: r.ending })
            : kind === "decline"
              ? act("decline", { reason: r.text })
              : kind === "ask"
                ? act("ask-info", { question: r.text, ask: r.ask })
                : act("merge", { into: r.text }));
    if (ok) toast.success("Saved");
    return ok;
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    if (await act(composer, { body: message })) {
      setMessage("");
      toast.success(composer === "reply" ? "Reply sent to the submitter" : "Note added");
      setFeedFilter((f) => (f === "history" ? "all" : f));
      setJustSent("latest");
    }
  }

  // The new entry is brought into view and marked "Sent just now" for a few seconds, so the person sees it landed.
  useEffect(() => {
    if (!justSent) return;
    document.getElementById("sent-just-now")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setJustSent(null), 4000);
    return () => clearTimeout(timer);
  }, [justSent, item]);

  const chat = item?.messages.filter((m) => m.message_type === "chat") ?? [];
  const talk = item?.messages.filter((m) => m.message_type !== "chat") ?? [];
  const awaiting = item && (item.status === "awaiting_approval" || item.status === "needs_review");
  const open = item && !["declined", "closed", "acknowledged"].includes(item.status);
  const changeField = (field: string, value: string | null) => void act("", { [field]: value }, "patch");

  return (
    <Sheet open={reference !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl data-[side=right]:lg:max-w-5xl">
        {!item && loadError ? (
          <div className="grid gap-3 p-6" role="alert">
            <SheetTitle className="text-xl font-bold">{reference} could not be opened</SheetTitle>
            <SheetDescription>{loadError}</SheetDescription>
            <Button
              variant="outline"
              className="h-10 justify-self-start rounded-xl"
              onClick={() => {
                setLoadError(null);
                load();
              }}
            >
              Try again
            </Button>
          </div>
        ) : !item ? (
          <div className="grid gap-3 p-6" aria-busy="true">
            <SheetTitle className="sr-only">Loading {reference}</SheetTitle>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            <header className="sticky top-0 z-10 border-b bg-card px-5 pt-5 pb-4">
              <div className="flex flex-wrap items-center gap-1.5 pr-8">
                <span className="font-mono text-sm font-semibold">{item.reference}</span>
                <PriorityBadge showCode priority={item.priority} />
                <StatusBadge status={item.status} ending={item.ending} />
                {item.reporters > 1 && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <Users className="size-3.5" aria-hidden="true" /> Reported by {item.reporters} people
                  </span>
                )}
                {item.priority_review && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning">
                    <TrendingUp className="size-3.5" aria-hidden="true" /> Priority review suggested
                  </span>
                )}
                {item.needs_detail && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <CircleHelp className="size-3.5" aria-hidden="true" /> Needs detail: ask for info first
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="icon" className="size-9 rounded-lg" disabled={!previous} onClick={() => previous && onStep(previous)} aria-label="Previous item">
                    <ChevronUp aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-9 rounded-lg" disabled={!next} onClick={() => next && onStep(next)} aria-label="Next item">
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </span>
              </div>
              <SheetTitle className="mt-2 text-xl leading-snug font-bold">{item.title}</SheetTitle>
              <SheetDescription>
                {[item.work_type && WORK_TYPE_LABEL[item.work_type], item.project?.name ?? "Tool to confirm", item.submitter_name].filter(Boolean).join(" · ")} · {ago(item.created_at)}
                {item.channel === "fallback" && " · backup form"}
              </SheetDescription>
              <div className="mt-3 flex flex-wrap gap-2">
                {awaiting && me.role === "admin" && (
                  <>
                    <Button className="h-10 rounded-xl" disabled={busy} onClick={() => void act("approve").then((ok) => ok && toast.success("Approved"))}>
                      Approve
                    </Button>
                    <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "decline" })}>
                      Decline
                    </Button>
                    <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "ask" })}>
                      Ask for info
                    </Button>
                  </>
                )}
                {item.status === "approved" && (
                  <Button className="h-10 rounded-xl" disabled={busy} onClick={() => void act("start")}>
                    Start work
                  </Button>
                )}
                {item.status === "in_progress" && (
                  <Button className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "resolve" })}>
                    Resolve
                  </Button>
                )}
                {open && !awaiting && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "update" })}>
                    Post update
                  </Button>
                )}
                {open && (
                  <Button variant="ghost" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: item.status === "resolved" ? "fix" : "close" })}>
                    {item.status === "resolved" ? "Close as fixed" : "Close"}
                  </Button>
                )}
              </div>
              {awaiting && me.role !== "admin" && <p className="mt-2 text-sm text-muted-foreground">Waiting for an Admin to approve. Work starts once it&apos;s approved.</p>}
            </header>

            <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <aside aria-label="Properties" className="order-first grid content-start gap-3 lg:sticky lg:top-44 lg:order-last lg:self-start">
                <p className="text-sm font-semibold">Properties (corrections are logged)</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <FieldSelect label={`Project (${percent(item.ai_confidence.project)})`} value={item.project?.slug ?? ""} options={projects.map((p) => [p.slug, p.name])} onChange={(v) => changeField("project_slug", v)} />
                  <FieldSelect label={`Work type (${percent(item.ai_confidence.work_type)})`} value={item.work_type ?? ""} options={WORK_TYPES.map((w) => [w, WORK_TYPE_LABEL[w]])} onChange={(v) => changeField("work_type", v)} />
                  <FieldSelect label={`Category (${percent(item.ai_confidence.category)})`} value={item.category ?? ""} options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])} onChange={(v) => changeField("category", v)} />
                  <FieldSelect label={`Priority (${percent(item.ai_confidence.priority)})`} value={item.priority ?? ""} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} onChange={(v) => changeField("priority", v)} />
                  <FieldSelect
                    label="Assignee"
                    value={item.assignee?.id ?? "none"}
                    options={[["none", "Unassigned"], ...staff.filter((s) => s.active).map((s): [string, string] => [s.id, `${s.name}${s.is_away ? " (away)" : ""}`])]}
                    onChange={(v) => changeField("assignee_id", v === "none" ? null : v)}
                  />
                </div>
                <div className="grid gap-1 text-sm">
                  <p className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Expected by</span>
                    <span className={cn(item.overdue && "font-semibold text-destructive")}>{item.expected_by ? day(item.expected_by) : "Not set"}</span>
                  </p>
                  {item.followers.length > 0 && (
                    <p className="text-muted-foreground">Also following: {item.followers.join(", ")}</p>
                  )}
                </div>
              </aside>

              <Tabs defaultValue="brief" className="min-w-0">
                <TabsList className="w-full">
                  <TabsTrigger value="brief">Brief</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="files">Files ({item.attachments.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="brief" className="grid gap-5 pt-3">
                {(item.duplicates.length > 0 || item.linked.length > 0 || item.merged_into) && (
                  <section className="grid gap-2 rounded-2xl border p-4" aria-label="Duplicates">
                    <p className="text-sm font-semibold">Possible duplicates</p>
                    {item.merged_into && <p className="text-sm">Merged into {item.merged_into}.</p>}
                    {item.linked.length > 0 && <p className="text-sm text-muted-foreground">Merged here: {item.linked.join(", ")}</p>}
                    {item.duplicates.map((d) => (
                      <div key={d.reference} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="font-mono font-semibold">{d.reference}</span> · {d.title} · {Math.round(d.similarity * 100)}% similar
                        </span>
                        {open && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog({ kind: "merge", text: d.reference })}>
                            Merge into it
                          </Button>
                        )}
                      </div>
                    ))}
                    {open && (
                      <Button variant="link" className="justify-self-start px-0" onClick={() => setDialog({ kind: "merge" })}>
                        Merge into another reference…
                      </Button>
                    )}
                  </section>
                )}
                {item.ai_recommendation?.decision && (
                  <p className="rounded-2xl bg-muted p-3 text-sm">
                                        <span>
                      <strong>Recommendation: {item.ai_recommendation.decision.replace("_", " ")}.</strong> {item.ai_recommendation.reason}
                      {item.effort && ` Effort ${item.effort}.`} {item.impact && `Impact: ${item.impact.replace("_", " ")}.`}
                    </span>
                  </p>
                )}
                <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                  {BRIEF_ROWS.map(([key, label]) => {
                    const value = item.dev_brief[key];
                    if (!value || (Array.isArray(value) && value.length === 0)) return null;
                    return (
                      <div key={key} className="contents">
                        <dt className="font-medium text-muted-foreground">{label}</dt>
                        <dd className={cn(key === "submitter_quote" && "italic")}>
                          {Array.isArray(value) ? (
                            <ol className="list-decimal pl-5">
                              {value.map((v) => (
                                <li key={v}>{v}</li>
                              ))}
                            </ol>
                          ) : key === "submitter_quote" ? (
                            `“${value}”`
                          ) : (
                            value
                          )}
                        </dd>
                      </div>
                    );
                  })}
                  <dt className="font-medium text-muted-foreground">Context</dt>
                  <dd className="text-muted-foreground">
                    {["device", "browser", "screen", "source", "time"]
                      .map((k) => item.context[k])
                      .filter(Boolean)
                      .join(" · ") || "Not captured"}
                  </dd>
                  {item.dev_brief.open_gaps && item.dev_brief.open_gaps.length > 0 && (
                    <>
                      <dt className="font-medium text-warning">Open gaps</dt>
                      <dd>
                        <ul className="list-disc pl-5">
                          {item.dev_brief.open_gaps.map((g) => (
                            <li key={g}>{g}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                </dl>

                </TabsContent>

                <TabsContent value="activity" className="grid gap-4 pt-3">
                  <ToggleGroup type="single" value={feedFilter} onValueChange={(v) => v && setFeedFilter(v as typeof feedFilter)} variant="outline" size="sm" spacing={0} aria-label="Show">
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                    <ToggleGroupItem value="messages">Messages</ToggleGroupItem>
                    <ToggleGroupItem value="history">History</ToggleGroupItem>
                  </ToggleGroup>

                  {feedFilter !== "history" && (
                    <>
                      {chat.length > 0 && (
                        <section aria-label="Intake transcript" className="rounded-2xl border bg-muted/30">
                          <details open className="group">
                            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 p-3 text-sm font-semibold">
                              Intake transcript
                              <span className="text-xs font-normal text-muted-foreground">
                                Word for word, as written in the chat. It can&apos;t be edited. ({chat.length})
                              </span>
                            </summary>
                            <ol className="grid gap-3 border-t p-3">
                              {chat.map((m) => (
                                <li key={m.id} className="text-sm">
                                  <p className="mb-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                    <span className="font-semibold text-foreground">{m.author_type === "staff" ? (m.author_name ?? "Staff member") : "Assistant"}</span>
                                    {m.author_type === "staff" && <span>Staff member</span>}
                                    <span>{when(m.created_at)}</span>
                                  </p>
                                  <blockquote className="border-l-2 pl-3 whitespace-pre-wrap italic">&ldquo;{m.body}&rdquo;</blockquote>
                                </li>
                              ))}
                            </ol>
                          </details>
                        </section>
                      )}

                      <section aria-label="Conversation" className="grid gap-2">
                        <h3 className="text-sm font-semibold">Conversation</h3>
                        {talk.length === 0 && <p className="text-sm text-muted-foreground">No replies or notes yet.</p>}
                        <ol className="grid gap-2">
                          {talk.map((m, i) => (
                            <li
                              key={m.id}
                              id={justSent && i === talk.length - 1 ? "sent-just-now" : undefined}
                              className={cn(
                                "rounded-2xl border p-3 text-sm transition-shadow",
                                m.is_internal && "border-dashed border-warning/60 bg-warning-tint",
                                !m.is_internal && m.author_type === "staff" && "bg-muted/50",
                                justSent && i === talk.length - 1 && "ring-2 ring-ring",
                              )}
                            >
                              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">{m.author_name ?? "Feedback"}</span>
                                {m.is_internal && <Lock className="size-3" aria-hidden="true" />}
                                {MESSAGE_LABEL[m.message_type]} · {when(m.created_at)}
                                {justSent && i === talk.length - 1 && <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">Sent just now</span>}
                              </p>
                              <p className="whitespace-pre-wrap">{m.body}</p>
                            </li>
                          ))}
                        </ol>
                        {open && (
                          <form onSubmit={sendMessage} className={cn("grid gap-2 rounded-2xl border p-3 transition-colors", composer === "note" && "border-warning/60 bg-warning-tint")}>
                            <ToggleGroup type="single" value={composer} onValueChange={(v) => v && setComposer(v as "reply" | "note")} variant="outline" size="sm" spacing={0} aria-label="Message type" className="justify-self-start bg-background">
                              <ToggleGroupItem value="reply">Reply to submitter</ToggleGroupItem>
                              <ToggleGroupItem value="note">
                                <Lock aria-hidden="true" /> Internal note
                              </ToggleGroupItem>
                            </ToggleGroup>
                            <Textarea
                              rows={3}
                              value={message}
                              onChange={(e) => setMessage(e.target.value)}
                              aria-label={composer === "reply" ? "Reply to the submitter" : "Internal note (staff never see it)"}
                              placeholder={composer === "reply" ? "They see this on their tracker and by email" : "Only the Digital team sees this"}
                              className="rounded-xl bg-background"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                {composer === "note" && <Lock className="size-3" aria-hidden="true" />}
                                {composer === "reply" ? "The submitter sees this." : "Only the Digital team sees this."}
                              </p>
                              <Button type="submit" variant={composer === "reply" ? "default" : "outline"} className="rounded-xl" disabled={busy || !message.trim()}>
                                {composer === "reply" ? "Send reply" : "Add note"}
                              </Button>
                            </div>
                          </form>
                        )}
                      </section>
                    </>
                  )}

                  {feedFilter !== "messages" && (
                    <section aria-label="History" className="grid gap-2">
                      <h3 className="text-sm font-semibold">History</h3>
                      <ol className="grid gap-2">
                        {[...item.events]
                          .sort((x, y) => x.created_at.localeCompare(y.created_at))
                          .map((e, i) => (
                            <li key={`${e.created_at}-${i}`} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm">
                              <span>
                                <span className="font-medium">{e.actor_name ?? e.actor_type}</span> · {e.public_text ?? describe(e.event_type, e.before, e.after)}
                                {!e.is_public && <span className="ml-1 text-xs text-muted-foreground">(internal)</span>}
                              </span>
                              <time className="font-mono text-xs text-muted-foreground" dateTime={e.created_at}>
                                {when(e.created_at)}
                              </time>
                            </li>
                          ))}
                      </ol>
                    </section>
                  )}
                </TabsContent>

                <TabsContent value="files" className="grid gap-3 pt-3">
                {item.attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached.</p>}
                {item.attachments.map((a) => (
                  <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="grid gap-2 rounded-2xl border p-3 hover:bg-muted/50">
                    {a.mime_type.startsWith("image/") && (
                      // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link; next/image can't optimise it
                      <img src={`/api/files/${a.id}`} alt={`Attachment ${a.file_name}`} className="max-h-64 rounded-xl object-contain" />
                    )}
                    <span className="flex items-center gap-2 text-sm">
                      <FileText className="size-4" aria-hidden="true" /> {a.file_name} · {fileSize(a.size_bytes)}
                    </span>
                  </a>
                ))}
                </TabsContent>
              </Tabs>
            </div>
            <ActionDialog key={`${dialog?.kind}-${dialog?.text}`} kind={dialog?.kind ?? null} initialText={dialog?.text} onClose={() => setDialog(null)} onSubmit={onDialog} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function describe(type: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const pair = (o: Record<string, unknown>) =>
    Object.entries(o)
      .filter(([k]) => !["reason", "confidence", "correction"].includes(k))
      .map(([k, v]) => `${k} ${String(v ?? "none")}`)
      .join(", ");
  if (type === "correction") return `corrected ${pair(before)} → ${pair(after)}`;
  if (type === "status") return `status ${String(before.status ?? "")} → ${String(after.status ?? "")}`;
  return type.replace(/_/g, " ");
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full rounded-xl text-sm text-foreground">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
