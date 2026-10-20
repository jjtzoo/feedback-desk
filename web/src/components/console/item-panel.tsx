"use client";

import { Bot, Check, CircleSlash, FileText, Gavel, GitMerge, Hammer, Lock, MessageCircleQuestion, Play, Send, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PriorityBadge, StatusBadge, WorkTypeBadge } from "@/components/badges";
import { ActionDialog, type ActionKind, type ActionResult } from "@/components/console/action-dialogs";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Detail, type Project, type Staff } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, WORK_TYPES, WORK_TYPE_LABEL, age, fileSize, when } from "@/lib/format";
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
  onClose,
  onChanged,
}: {
  reference: string | null;
  projects: Project[];
  staff: Staff[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = useMe();
  const [item, setItem] = useState<Detail | null>(null);
  const [dialog, setDialog] = useState<ActionKind | null>(null);
  const [composer, setComposer] = useState<"reply" | "note">("reply");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!reference) return;
    api.get<Detail>(`/console/items/${reference}`).then(setItem).catch((e: unknown) => toast.error(errorText(e)));
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
        : kind === "close"
          ? act("close", { reason: r.text, wont_fix: r.wontFix })
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
    }
  }

  const awaiting = item && (item.status === "awaiting_approval" || item.status === "needs_review");
  const open = item && !["declined", "closed", "acknowledged"].includes(item.status);
  const changeField = (field: string, value: string | null) => void act("", { [field]: value }, "patch");

  return (
    <Sheet open={reference !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {!item ? (
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
                <span className="font-mono text-sm font-semibold text-brand-text">{item.reference}</span>
                <WorkTypeBadge workType={item.work_type} />
                <PriorityBadge priority={item.priority} />
                <StatusBadge status={item.status} />
              </div>
              <SheetTitle className="mt-2 text-xl leading-snug font-bold">{item.title}</SheetTitle>
              <SheetDescription>
                {item.project?.name ?? "Tool to confirm"} · {item.submitter_name} · {age(item.created_at)} ago
                {item.channel === "fallback" && " · backup form"}
              </SheetDescription>
              <div className="mt-3 flex flex-wrap gap-2">
                {awaiting && me.role === "admin" && (
                  <>
                    <Button className="h-10 rounded-xl" disabled={busy} onClick={() => void act("approve").then((ok) => ok && toast.success("Approved"))}>
                      <Gavel /> Approve
                    </Button>
                    <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog("decline")}>
                      <CircleSlash /> Decline
                    </Button>
                    <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog("ask")}>
                      <MessageCircleQuestion /> Ask for info
                    </Button>
                  </>
                )}
                {item.status === "approved" && (
                  <Button className="h-10 rounded-xl" disabled={busy} onClick={() => void act("start")}>
                    <Play /> Start work
                  </Button>
                )}
                {item.status === "in_progress" && (
                  <Button className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog("resolve")}>
                    <Check /> Resolve
                  </Button>
                )}
                {open && !awaiting && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog("update")}>
                    <Hammer /> Post update
                  </Button>
                )}
                {open && (
                  <Button variant="ghost" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog("close")}>
                    <X /> Close
                  </Button>
                )}
              </div>
              {awaiting && me.role !== "admin" && <p className="mt-2 text-sm text-muted-foreground">Waiting for an Admin to approve. Work starts once it&apos;s approved.</p>}
            </header>

            <Tabs defaultValue="brief" className="px-5 py-4">
              <TabsList className="w-full">
                <TabsTrigger value="brief">Brief</TabsTrigger>
                <TabsTrigger value="talk">Conversation ({item.messages.length})</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="files">Files ({item.attachments.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="brief" className="grid gap-5 pt-3">
                {item.ai_recommendation?.decision && (
                  <p className="flex gap-2 rounded-2xl bg-muted p-3 text-sm">
                    <Bot className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden="true" />
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

                <section className="grid gap-3 rounded-2xl border p-4" aria-label="Classification">
                  <p className="text-sm font-semibold">Classification · corrections are logged to improve routing</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldSelect
                      label={`Project (${percent(item.ai_confidence.project)})`}
                      value={item.project?.slug ?? ""}
                      options={projects.map((p) => [p.slug, p.name])}
                      onChange={(v) => changeField("project_slug", v)}
                    />
                    <FieldSelect
                      label={`Work type (${percent(item.ai_confidence.work_type)})`}
                      value={item.work_type ?? ""}
                      options={WORK_TYPES.map((w) => [w, WORK_TYPE_LABEL[w]])}
                      onChange={(v) => changeField("work_type", v)}
                    />
                    <FieldSelect
                      label={`Category (${percent(item.ai_confidence.category)})`}
                      value={item.category ?? ""}
                      options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])}
                      onChange={(v) => changeField("category", v)}
                    />
                    <FieldSelect
                      label={`Priority (${percent(item.ai_confidence.priority)})`}
                      value={item.priority ?? ""}
                      options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])}
                      onChange={(v) => changeField("priority", v)}
                    />
                    <FieldSelect
                      label="Assignee"
                      value={item.assignee?.id ?? "none"}
                      options={[["none", "Unassigned"], ...staff.filter((s) => s.active).map((s): [string, string] => [s.id, `${s.name}${s.is_away ? " (away)" : ""}`])]}
                      onChange={(v) => changeField("assignee_id", v === "none" ? null : v)}
                    />
                  </div>
                </section>

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
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act("merge", { into: d.reference })}>
                            <GitMerge /> Merge into it
                          </Button>
                        )}
                      </div>
                    ))}
                    {open && (
                      <Button variant="link" className="justify-self-start px-0" onClick={() => setDialog("merge")}>
                        Merge into another reference…
                      </Button>
                    )}
                  </section>
                )}
                {item.followers.length > 0 && <p className="text-sm text-muted-foreground">Also following: {item.followers.join(", ")}</p>}
              </TabsContent>

              <TabsContent value="talk" className="grid gap-3 pt-3">
                <ol className="grid gap-2">
                  {item.messages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "rounded-2xl border p-3 text-sm",
                        m.is_internal && "border-dashed border-warning/60 bg-warning-tint/40",
                        m.author_type === "staff" && "bg-muted/50",
                      )}
                    >
                      <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {m.is_internal && <Lock className="size-3" aria-hidden="true" />}
                        <span className="font-semibold text-foreground">{m.author_name ?? "Feedback"}</span>
                        {MESSAGE_LABEL[m.message_type]} · {when(m.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ol>
                {open && (
                  <form onSubmit={sendMessage} className="grid gap-2 rounded-2xl border p-3">
                    <div className="flex gap-1" role="group" aria-label="Message type">
                      {(["reply", "note"] as const).map((k) => (
                        <Button key={k} type="button" size="sm" variant={composer === k ? "secondary" : "ghost"} aria-pressed={composer === k} onClick={() => setComposer(k)}>
                          {k === "reply" ? <Send /> : <StickyNote />} {k === "reply" ? "Reply to submitter" : "Internal note"}
                        </Button>
                      ))}
                    </div>
                    <Textarea
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      aria-label={composer === "reply" ? "Reply to the submitter" : "Internal note (staff never see it)"}
                      placeholder={composer === "reply" ? "They see this on their tracker and by email" : "Only the Digital team sees this"}
                      className="rounded-xl"
                    />
                    <Button type="submit" variant={composer === "reply" ? "default" : "outline"} className="justify-self-end rounded-xl" disabled={busy || !message.trim()}>
                      {composer === "reply" ? "Send reply" : "Add note"}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="history" className="pt-3">
                <ol className="grid gap-2 text-sm">
                  {item.events.map((e, i) => (
                    <li key={`${e.created_at}-${i}`} className="flex flex-wrap justify-between gap-2 border-b pb-2">
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
              </TabsContent>

              <TabsContent value="files" className="grid gap-3 pt-3">
                {item.attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached.</p>}
                {item.attachments.map((a) => (
                  <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="grid gap-2 rounded-2xl border p-3 hover:border-primary/40">
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
            <ActionDialog kind={dialog} onClose={() => setDialog(null)} onSubmit={onDialog} />
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
