"use client";

import { ArrowDown, ChevronDown, ChevronUp, CircleHelp, FileText, ImagePlus, Lock, TrendingUp, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FileThumbs, IMAGES, ScreenshotNote, pastedImages, preview, withinLimits } from "@/components/attach";
import { NewMark, PriorityBadge, StatusBadge } from "@/components/badges";
import { ActionDialog, type ActionKind, type ActionResult } from "@/components/console/action-dialogs";
import { RoutingLine } from "@/components/console/routing-line";
import { StatusMenu } from "@/components/console/status-menu";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Detail, type Message, type Project, type Staff } from "@/lib/api";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  WORK_TYPES,
  WORK_TYPE_LABEL,
  ago,
  contextText,
  day,
  fileSize,
  isSettled,
  recommendationText,
  when,
} from "@/lib/format";
import { actorName, historyLine } from "@/lib/history";
import { allowedMoves, type Move } from "@/lib/moves";
import { ownership } from "@/lib/ownership";
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
const MESSAGE_LABEL: Record<string, string> = { chat: "Chat", reply: "Reply", note: "Internal note", progress: "Update", follow_up: "Follow-up" };
// The panel's tabs; each conversation has its own (D103).
const TABS = ["brief", "reporter", "team", "history", "files"];
/** The two conversations: with the person who raised it (replies) and the team's (notes). */
type Side = "reply" | "note";
type Field = "project_slug" | "work_type" | "category" | "priority";

function percent(n: number | undefined) {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

/** The detail panel beside the board (brief §4.4): developer brief first, then the conversation with the
 *  person who raised it, the team's internal one, History and Files, each its own tab (D103). A
 *  notification opens it on the tab it is about, at its message, briefly highlighted (D81). */
export function ItemPanel({
  reference,
  focusTab = null,
  focusMessage = null,
  projects,
  staff,
  previous,
  next,
  onStep,
  onClose,
  onChanged,
}: {
  reference: string | null;
  focusTab?: string | null;
  focusMessage?: string | null;
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
  // A message's tab is known once the item loads (D103).
  const [tab, setTab] = useState(focusTab && TABS.includes(focusTab) ? focusTab : "brief");
  const [highlight, setHighlight] = useState(focusMessage);
  // When this person last looked before this visit; kept while the panel stays open, so acting doesn't clear New (D82).
  const [lastRead, setLastRead] = useState<string | null | undefined>(undefined);
  // Which conversation just got a message, so its newest entry is marked "Sent just now".
  const [justSent, setJustSent] = useState<Side | null>(null);
  const [drafts, setDrafts] = useState<Record<Side, string>>({ reply: "", note: "" });
  // Corrections to the properties, kept until Save (D104).
  const [fields, setFields] = useState<Partial<Record<Field, string>>>({});
  // Images to send with a reply, for example to show the fix (D95); notes take none.
  const [images, setImages] = useState<{ file: File; src: string | null }[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!reference) return;
    api
      .get<Detail>(`/console/items/${reference}`)
      .then((d) => {
        setItem(d);
        setLastRead((seen) => (seen === undefined ? d.last_read_at : seen));
        // A notification's message opens in its conversation (D103).
        const focused = d.messages.find((m) => m.id === focusMessage);
        if (focused) setTab(focused.is_internal ? "team" : "reporter");
      })
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, [reference, focusMessage]);

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
    const call: Record<ActionKind, [string, unknown]> = {
      approve: ["approve", { instructions: r.text, priority: r.priority ?? null, due_date: r.expectedBy ?? null }],
      update: ["update", { body: r.text, expected_by: r.expectedBy ?? null, due_reason: r.dueReason ?? "" }],
      resolve: ["resolve", { body: r.text }],
      fix: ["close", { ending: "fixed", reason: r.text }],
      close: ["close", { reason: r.text, ending: r.ending }],
      decline: ["decline", { reason: r.text }],
      ask: ["ask-info", { question: r.text, ask: r.ask }],
      merge: ["merge", { into: r.text }],
      // Sends who had it when the dialog opened, so a second person taking it at once is told (D53).
      take_over: ["take-over", { holder_id: item?.assignee?.id, reason: r.text }],
      hand_over: ["hand-over", { to: r.to, reason: r.text }],
    };
    const ok = await act(...call[kind]);
    if (ok) toast.success(kind === "approve" ? "Approved" : "Saved");
    return ok;
  }

  function addImages(files: File[]) {
    if (!item) return;
    const { ok, error } = withinLimits(files, item.attachments.length + images.length, item.max_files, item.max_file_mb);
    if (error) toast.error(error);
    setImages((all) => [...all, ...ok.map((file) => ({ file, src: preview(file) }))]);
  }

  async function sendMessage(e: FormEvent, side: Side) {
    e.preventDefault();
    const text = drafts[side];
    if (!text.trim() || !reference) return;
    const withImages = side === "reply" ? images : [];
    try {
      // The images go on the item first, so the reply they belong to never arrives without them.
      for (const image of withImages) await api.upload(`/feedback/${reference}/attachments`, image.file);
    } catch (err) {
      toast.error(errorText(err));
      return;
    }
    if (await act(side, { body: text })) {
      withImages.forEach((image) => image.src && URL.revokeObjectURL(image.src));
      if (withImages.length) setImages([]);
      setDrafts((d) => ({ ...d, [side]: "" }));
      toast.success(side === "reply" ? `Sent to ${firstName}` : "Sent to the team");
      setJustSent(side);
    }
  }

  async function saveFields() {
    if (await act("", fields, "patch")) {
      setFields({});
      toast.success("Saved");
    }
  }

  // The new entry is brought into view and marked "Sent just now" for a few seconds, so the person sees it landed.
  useEffect(() => {
    if (!justSent) return;
    document.getElementById("sent-just-now")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setJustSent(null), 4000);
    return () => clearTimeout(timer);
  }, [justSent, item]);

  // The message a notification pointed at comes into view and stays marked for a moment (D81).
  useEffect(() => {
    if (!highlight || !item) return;
    document.getElementById(`msg-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [highlight, item]);

  const chat = item?.messages.filter((m) => m.message_type === "chat") ?? [];
  const talk = item?.messages.filter((m) => m.message_type !== "chat") ?? [];
  // The two sides of the conversation, kept apart (D96).
  const withThem = talk.filter((m) => !m.is_internal);
  const internal = talk.filter((m) => m.is_internal);
  // Pinned for whoever works it; newest first, so the first is the approval's (D93).
  const instructions = item?.events.find((e) => e.event_type === "instructions");
  const awaiting = item && (item.status === "awaiting_approval" || item.status === "needs_review");
  const open = item && !["declined", "closed", "acknowledged"].includes(item.status);
  // A pick that puts a property back as it was is no longer a change.
  const current: Record<Field, string> = { project_slug: item?.project?.slug ?? "", work_type: item?.work_type ?? "", category: item?.category ?? "", priority: item?.priority ?? "" };
  const changeField = (field: Field, value: string) =>
    setFields((f) => {
      const next = { ...f, [field]: value };
      if (value === current[field]) delete next[field];
      return next;
    });
  const changed = Object.keys(fields).length > 0;
  const can = item ? ownership(item, me, staff) : null;
  // Approving is the Admin's decision, with its own buttons; the Status menu holds the stage moves (D91).
  const moves = item ? allowedMoves(item, me, staff).filter((m) => m.key !== "approve") : [];
  function onMove(m: Move) {
    if (m.key === "start" || m.key === "restart") void act("start").then((ok) => ok && toast.success(m.key === "start" ? "Started" : "Started again"));
    else setDialog({ kind: m.key === "resolve" ? "resolve" : m.key === "close_fixed" ? "fix" : "close" });
  }
  // Someone else's words since you last looked; on an item you never opened, only when it's yours (D82).
  const isNew = (m: Message) => m.author_name !== me.name && (lastRead ? m.created_at > lastRead : lastRead === null && Boolean(can?.holder));
  const firstName = item?.submitter_name.split(" ")[0] ?? "";
  // Who hears about a team note: whoever has it and the approver, apart from you (D101).
  const approverName = staff.find((s) => s.google_email === item?.approved_by)?.name;
  const team = [...new Set([item?.assignee?.name, approverName])].filter((n): n is string => Boolean(n) && n !== me.name);
  // The Take over dialog says whose it is and what they last did, so nobody grabs work that is moving (D53).
  const holder = item?.assignee?.name;
  function messageRow(m: Message, sentNow: boolean) {
    return (
      <li
        key={m.id}
        id={sentNow ? "sent-just-now" : `msg-${m.id}`}
        className={cn(
          "rounded-2xl border p-3 text-sm transition-shadow",
          m.is_internal && "border-dashed border-warning/60 bg-warning-tint",
          !m.is_internal && m.author_type === "staff" && "bg-muted/50",
          (sentNow || highlight === m.id) && "ring-2 ring-ring",
        )}
      >
        <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {isNew(m) && <NewMark />}
          <span className="font-semibold text-foreground">{m.author_type === "system" ? "System" : (m.author_name ?? "Someone")}</span>
          {m.is_internal && <Lock className="size-3" aria-hidden="true" />}
          {MESSAGE_LABEL[m.message_type]}
          {m.asks_check && " · asked them to check"} · {when(m.created_at)}
          {sentNow && <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">Sent just now</span>}
        </p>
        <p className="whitespace-pre-wrap">{m.body}</p>
      </li>
    );
  }
  function composer(side: Side) {
    const reply = side === "reply";
    return (
      <form
        onSubmit={(e) => void sendMessage(e, side)}
        className={cn("grid gap-2 rounded-2xl border p-3", reply ? "border-primary/50 bg-primary/5" : "border-dashed border-warning/60 bg-warning-tint")}
      >
        <Textarea
          rows={3}
          value={drafts[side]}
          onChange={(e) => setDrafts((d) => ({ ...d, [side]: e.target.value }))}
          onPaste={(e) => {
            const pasted = reply ? pastedImages(e) : [];
            if (pasted.length === 0) return;
            e.preventDefault();
            addImages(pasted);
          }}
          aria-label={reply ? `Message to ${firstName} (they'll see it)` : "Note to the team (staff never see it)"}
          placeholder={reply ? `Write to ${firstName}` : team.length > 0 ? `Write to ${team.join(" and ")}` : "Write a note for the team"}
          className="rounded-xl bg-background"
        />
        {reply && images.length > 0 && (
          <div className="grid gap-2">
            <FileThumbs
              files={images.map((image, i) => ({ key: String(i), name: image.file.name, size: image.file.size, src: image.src }))}
              onRemove={(key) => setImages((all) => all.filter((_, i) => String(i) !== key))}
            />
            <ScreenshotNote files={images.map((image, i) => ({ key: String(i), name: image.file.name, src: image.src }))} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reply && (
            <>
              <input
                ref={imageInput}
                type="file"
                accept={IMAGES}
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="reply-images"
                onChange={(e) => {
                  addImages(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="ghost" className="rounded-xl" disabled={busy} onClick={() => imageInput.current?.click()}>
                <ImagePlus /> Add an image
              </Button>
            </>
          )}
          <Button type="submit" variant={reply ? "default" : "outline"} className="rounded-xl" disabled={busy || !drafts[side].trim()}>
            {reply ? `Send to ${firstName}` : "Send to the team"}
          </Button>
        </div>
      </form>
    );
  }
  const takeOverText = !item
    ? undefined
    : item.assignee_away
      ? `${holder} is marked away.`
      : item.holder_activity
        ? `${holder} ${item.holder_activity.text} ${ago(item.holder_activity.at)}.`
        : `${holder} hasn't done anything on it yet.`;

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
                <PriorityBadge showCode quiet={isSettled(item.status)} priority={item.priority} />
                {/* The Status menu says it when there is a move to make (D91). */}
                {moves.length === 0 && <StatusBadge status={item.status} ending={item.ending} />}
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
                    <Button className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "approve" })}>
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
                {moves.length > 0 && <StatusMenu status={item.status} moves={moves} busy={busy} onMove={onMove} />}
                {open && !awaiting && can?.holder && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "update" })}>
                    Update {firstName}
                  </Button>
                )}
                {open && can?.canAssignToMe && item.status !== "approved" && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => void act("assign-to-me").then((ok) => ok && toast.success(`${item.reference} is yours`))}>
                    Assign to me
                  </Button>
                )}
                {open && can?.canTakeOver && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "take_over" })}>
                    Take over
                  </Button>
                )}
                {open && can?.canHandOver && (
                  <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setDialog({ kind: "hand_over" })}>
                    Hand over to…
                  </Button>
                )}
              </div>
              {awaiting && me.role !== "admin" && <p className="mt-2 text-sm text-muted-foreground">Waiting for an Admin to approve. Work starts once it&apos;s approved.</p>}
            </header>

            {instructions && (
              <section aria-label="Instructions at approval" className="mx-5 mt-4 rounded-2xl border border-dashed border-warning/60 bg-warning-tint p-3 text-sm">
                <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Lock className="size-3" aria-hidden="true" />
                  <span className="font-semibold text-foreground">From {instructions.actor_name ?? "an Admin"}, at approval</span>
                  <span>Only the Digital team sees this · {when(instructions.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap">{String(instructions.after.instructions ?? "")}</p>
              </section>
            )}

            <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <aside aria-label="Properties" className="order-first grid content-start gap-3 lg:sticky lg:top-44 lg:order-last lg:self-start">
                <p className="text-sm font-semibold">Properties (corrections are logged)</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <FieldSelect label={`Project (${percent(item.ai_confidence.project)})`} value={fields.project_slug ?? item.project?.slug ?? ""} options={projects.map((p) => [p.slug, p.name])} onChange={(v) => changeField("project_slug", v)} />
                  <FieldSelect label={`Work type (${percent(item.ai_confidence.work_type)})`} value={fields.work_type ?? item.work_type ?? ""} options={WORK_TYPES.map((w) => [w, WORK_TYPE_LABEL[w]])} onChange={(v) => changeField("work_type", v)} />
                  <FieldSelect label={`Category (${percent(item.ai_confidence.category)})`} value={fields.category ?? item.category ?? ""} options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])} onChange={(v) => changeField("category", v)} />
                  <FieldSelect label={`Priority (${percent(item.ai_confidence.priority)})`} value={fields.priority ?? item.priority ?? ""} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} onChange={(v) => changeField("priority", v)} />
                </div>
                {changed && (
                  <div className="flex gap-2">
                    <Button className="h-10 rounded-xl" disabled={busy} onClick={() => void saveFields()}>
                      Save
                    </Button>
                    <Button variant="outline" className="h-10 rounded-xl" disabled={busy} onClick={() => setFields({})}>
                      Cancel
                    </Button>
                  </div>
                )}
                <section aria-label="Who has it" className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">Who has it</p>
                  <RoutingLine item={item} />
                </section>
                <div className="grid gap-1 text-sm">
                  <p className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Due</span>
                    <span className={cn(item.overdue && "font-semibold text-destructive")}>{item.expected_by ? day(item.expected_by) : "Not set"}</span>
                  </p>
                  {item.followers.length > 0 && (
                    <p className="text-muted-foreground">Also following: {item.followers.join(", ")}</p>
                  )}
                </div>
              </aside>

              <Tabs value={tab} onValueChange={setTab} className="min-w-0">
                {/* Five tabs are wider than a phone: the row scrolls rather than clipping the last one. */}
                <TabsList className="w-full justify-start overflow-x-auto">
                  <TabsTrigger value="brief">Brief</TabsTrigger>
                  <TabsTrigger value="reporter">
                    With {firstName} ({withThem.length})
                  </TabsTrigger>
                  <TabsTrigger value="team">
                    <Lock aria-hidden="true" /> Team ({internal.length})
                  </TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
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
                    <strong>Recommendation: {recommendationText(item.ai_recommendation, item.effort, item.impact).head}.</strong>{" "}
                    {recommendationText(item.ai_recommendation, item.effort, item.impact).rest}
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
                  <dd className="text-muted-foreground">{contextText(item.context) || "Not captured"}</dd>
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

                {chat.length > 0 && (
                  <section aria-label="Intake transcript" className="rounded-2xl border bg-muted/30">
                    <details className="group">
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
                </TabsContent>

                <TabsContent value="reporter" className="grid gap-3 pt-3">
                  <p className="text-sm text-muted-foreground">
                    {firstName} sees these on their tracker and by email; what they write goes to whoever has it and the approver.
                  </p>
                  {withThem.length === 0 && <p className="text-sm text-muted-foreground">Nothing sent to {firstName} yet.</p>}
                  <ol className="grid gap-2">{withThem.map((m, i) => messageRow(m, justSent === "reply" && i === withThem.length - 1))}</ol>
                  {open && composer("reply")}
                </TabsContent>

                <TabsContent value="team" className="grid gap-3 pt-3">
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden="true" />
                    {team.length > 0 ? `Only the Digital team sees this. Each note goes to ${team.join(" and ")}.` : "Only the Digital team sees this."}
                  </p>
                  {internal.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
                  <ol className="grid gap-2">{internal.map((m, i) => messageRow(m, justSent === "note" && i === internal.length - 1))}</ol>
                  {open && composer("note")}
                </TabsContent>

                <TabsContent value="history" className="grid gap-2 pt-3">
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ArrowDown className="size-3" aria-hidden="true" /> Newest first
                  </p>
                  {/* In the API's order: newest first, steps written together in the order they happened (D77). */}
                  <ol className="grid gap-2">
                    {item.events.map((e) => (
                      <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm">
                        <span>
                          <span className="font-medium">{actorName(e)}</span> · {historyLine(e, projects)}
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
            <ActionDialog
              key={`${dialog?.kind}-${dialog?.text}`}
              kind={dialog?.kind ?? null}
              initialText={dialog?.text}
              title={
                dialog?.kind === "take_over"
                  ? `Take ${item.reference} over from ${holder}?`
                  : dialog?.kind === "update"
                    ? `Update ${firstName} on progress`
                    : dialog?.kind === "approve"
                      ? `Approve ${item.reference}`
                      : undefined
              }
              description={dialog?.kind === "take_over" ? `${takeOverText} They are told in the app and by email; the stage, due date and updates stay as they are.` : undefined}
              people={staff.filter((s) => s.active && s.id !== item.assignee?.id)}
              priority={item.priority}
              due={item.expected_by}
              onClose={() => setDialog(null)}
              onSubmit={onDialog}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
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
