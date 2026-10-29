"use client";

import { ChevronDown, ChevronUp, CircleHelp, Copy, FileText, ImagePlus, Lock, TrendingUp, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ActivityThread, ThreadPeople, type ThreadEntry } from "@/components/activity-thread";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
// The panel's tabs: one conversation, Activity, holds the messages and the changes (D105).
const TABS = ["brief", "activity", "files"];
// Links written before D105 name the tabs Activity replaced.
const OLD_TABS = ["reporter", "team", "history"];
/** What the composer sends: a reply the person who raised it sees, or an internal note (D96). */
type Side = "reply" | "note";
type Field = "project_slug" | "work_type" | "category" | "priority";

/** Two references in the order they came in: one sequence numbers them, so the lower one was first. */
function ordered(a: string, b: string) {
  const [first, later] = Number(a.replace(/\D/g, "")) < Number(b.replace(/\D/g, "")) ? [a, b] : [b, a];
  return { first, later };
}

function percent(n: number | undefined) {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

/** The detail panel beside the board (brief §4.4): developer brief first, then Conversation, the one
 *  conversation with the person who raised it, the holder and the approver, internal notes and changes
 *  included (D105), then Files. A notification opens it at its message, briefly highlighted (D81). */
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
  const [tab, setTab] = useState(focusTab && TABS.includes(focusTab) ? focusTab : focusTab && OLD_TABS.includes(focusTab) ? "activity" : "brief");
  const [highlight, setHighlight] = useState(focusMessage);
  // When this person last looked before this visit; kept while the panel stays open, so acting doesn't clear New (D82).
  const [lastRead, setLastRead] = useState<string | null | undefined>(undefined);
  // The newest entry is marked "Sent just now" right after sending.
  const [justSent, setJustSent] = useState(false);
  // Internal by default; replying to the person who raised it is a deliberate switch (D96).
  const [side, setSide] = useState<Side>("note");
  const [draft, setDraft] = useState("");
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
        // A notification's message opens in the conversation; so does an item someone wrote on since you last
        // looked, unless the link chose a tab. An item you never opened starts on its brief.
        const since = d.last_read_at;
        const written = since !== null && d.messages.some((m) => m.message_type !== "chat" && m.author_name !== me.name && m.created_at > since);
        if (d.messages.some((m) => m.id === focusMessage) || (written && !focusTab)) setTab("activity");
      })
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, [reference, focusMessage, focusTab, me.name]);

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
      due: ["update", { body: r.text, expected_by: r.expectedBy ?? null, due_reason: r.dueReason ?? "" }],
      resolve: ["resolve", { body: r.text }],
      fix: ["close", { ending: "fixed", reason: r.text }],
      close: ["close", { reason: r.text, ending: r.ending }],
      decline: ["decline", { reason: r.text }],
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

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const text = draft;
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
      setDraft("");
      toast.success(side === "reply" ? `Sent to ${firstName}` : "Internal note added");
      setJustSent(true);
      setSide("note"); // back to Internal note after each reply (D96)
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
    const timer = setTimeout(() => setJustSent(false), 4000);
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
  const unread = talk.filter(isNew).length;
  const firstName = item?.submitter_name.split(" ")[0] ?? "";
  // Who hears about a team note: whoever has it and the approver, apart from you (D101).
  const approverName = staff.find((s) => s.google_email === item?.approved_by)?.name;
  const team = [...new Set([item?.assignee?.name, approverName])].filter((n): n is string => Boolean(n) && n !== me.name);
  // The Take over dialog says whose it is and what they last did, so nobody grabs work that is moving (D53).
  const holder = item?.assignee?.name;
  // What each person is on this item, as the conversation names them (D105).
  function role(m: Message): string {
    if (m.author_type === "staff") return m.author_name === item?.submitter_name ? "Reporter" : "Staff";
    if (m.author_name === holder) return "Developer · has it";
    if (m.author_name === approverName) return "Admin · approved it";
    return "Digital team";
  }
  // Messages and changes in one conversation, oldest first; the approval's instructions are pinned on top (D105).
  const entries: ThreadEntry[] = !item
    ? []
    : [
        ...talk.map((m) => ({
          key: m.id,
          at: m.created_at,
          who: m.author_type === "system" ? "System" : (m.author_name ?? "Someone"),
          role: role(m),
          text: m.body,
          internal: m.is_internal,
          domId: `msg-${m.id}`,
          ring: highlight === m.id,
          marks: isNew(m) ? <NewMark /> : undefined,
        })),
        ...item.events
          .filter((e) => e.event_type !== "instructions")
          .map((e) => {
            const line = historyLine(e, projects);
            const who = actorName(e);
            return { key: e.id, at: e.created_at, text: line.includes(who) ? line : `${who} · ${line}`, internal: !e.is_public };
          }),
      ].sort((a, b) => a.at.localeCompare(b.at));
  if (justSent) {
    const sent = [...entries].reverse().find((e) => e.who === me.name);
    if (sent) Object.assign(sent, { domId: "sent-just-now", ring: true, marks: <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">Sent just now</span> });
  }
  const pinned: ThreadEntry[] = instructions
    ? [{ key: instructions.id, at: instructions.created_at, who: instructions.actor_name ?? "An Admin", role: "Admin · at approval", text: String(instructions.after.instructions ?? ""), internal: true, pinned: true }]
    : [];
  const people = item
    ? [
        { name: item.submitter_name, role: "Reporter" },
        ...(holder ? [{ name: holder, role: "Developer · has it" }] : []),
        ...(approverName ? [{ name: approverName, role: "Admin · approved it" }] : []),
      ]
    : [];
  // Merge from a duplicate's button: the dialog names which one closes into which (the server decides the same way).
  const merging = item && dialog?.kind === "merge" && dialog.text ? ordered(item.reference, dialog.text) : null;
  const reply = side === "reply";
  const composer = (
    <form onSubmit={(e) => void sendMessage(e)} className={cn("grid gap-2 rounded-2xl border p-3", reply ? "border-primary/50" : "border-dashed border-warning/60 bg-warning-tint")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ToggleGroup type="single" value={side} onValueChange={(v) => v && setSide(v as Side)} variant="outline" size="sm" spacing={0} aria-label="Send as" className="bg-background">
          <ToggleGroupItem value="reply">Reply to {firstName}</ToggleGroupItem>
          <ToggleGroupItem value="note">
            <Lock aria-hidden="true" /> Internal note
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          {reply ? `${firstName} sees it on their request and by email.` : team.length > 0 ? `Only the Digital team sees it. It goes to ${team.join(" and ")}.` : "Only the Digital team sees it."}
        </span>
      </div>
      <Textarea
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          const pasted = reply ? pastedImages(e) : [];
          if (pasted.length === 0) return;
          e.preventDefault();
          addImages(pasted);
        }}
        aria-label={reply ? `Message to ${firstName} (they'll see it)` : "Internal note (staff never see it)"}
        placeholder={reply ? `Write to ${firstName}` : "Write an internal note"}
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
        <Button type="submit" variant={reply ? "default" : "outline"} className="rounded-xl" disabled={busy || !draft.trim()}>
          {reply ? `Send to ${firstName}` : "Add internal note"}
        </Button>
      </div>
    </form>
  );
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
                  </>
                )}
                {moves.length > 0 && <StatusMenu status={item.status} moves={moves} busy={busy} onMove={onMove} />}
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

            <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              {/* A likely duplicate decides what happens to the whole item, so it sits above the tabs, marked while
                  the item is open; merging is still always a person's choice (F8). */}
              {(item.duplicates.length > 0 || item.linked.length > 0 || item.merged_into) && (
                <section
                  aria-label="Duplicates"
                  className={cn("order-first grid gap-2 rounded-2xl border p-4 lg:col-span-2", open && item.duplicates.length > 0 && "border-warning bg-warning-tint")}
                >
                  {item.duplicates.length > 0 && (
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Copy className="size-4" aria-hidden="true" /> Possible duplicates
                    </p>
                  )}
                  {item.merged_into && <p className="text-sm">Merged into {item.merged_into}.</p>}
                  {item.linked.length > 0 && <p className="text-sm text-muted-foreground">Merged here: {item.linked.join(", ")}</p>}
                  {item.duplicates.map((d) => (
                    <div key={d.reference} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span>
                        <span className="font-mono font-semibold">{d.reference}</span> · {d.title} · <strong>{Math.round(d.similarity * 100)}% similar</strong>
                      </span>
                      {/* From either item: the server always closes the newer one into the first report. */}
                      {open && (
                        <Button className="h-10 rounded-xl px-5" disabled={busy} onClick={() => setDialog({ kind: "merge", text: d.reference })}>
                          Merge
                        </Button>
                      )}
                    </div>
                  ))}
                  {open && (
                    <Button variant="link" className="justify-self-start px-0" onClick={() => setDialog({ kind: "merge" })}>
                      Merge with another reference…
                    </Button>
                  )}
                </section>
              )}
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
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Due</span>
                    <span className={cn(item.overdue && "font-semibold text-destructive", !item.expected_by && "text-muted-foreground")}>{item.expected_by ? day(item.expected_by) : "Not set"}</span>
                    {open && can?.holder && (
                      <Button variant="link" size="sm" className="h-auto px-0" disabled={busy} onClick={() => setDialog({ kind: "due" })}>
                        Change
                      </Button>
                    )}
                  </p>
                  {item.followers.length > 0 && (
                    <p className="text-muted-foreground">Also following: {item.followers.join(", ")}</p>
                  )}
                </div>
              </aside>

              <Tabs value={tab} onValueChange={setTab} className="min-w-0">
                <TabsList className="w-full">
                  <TabsTrigger value="brief">Brief</TabsTrigger>
                  <TabsTrigger value="activity">
                    Conversation ({talk.length})
                    {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{unread} new</span>}
                  </TabsTrigger>
                  <TabsTrigger value="files">Files ({item.attachments.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="brief" className="grid gap-5 pt-3">
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

                <TabsContent value="activity" className="grid gap-4 pt-3">
                  <ThreadPeople people={people} />
                  {pinned.length > 0 && <ActivityThread entries={pinned} empty="" />}
                  <ActivityThread entries={entries} empty="Nothing yet." />
                  {open && composer}
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
                  : dialog?.kind === "approve"
                      ? `Approve ${item.reference}`
                      : merging
                        ? `Merge ${merging.later} into ${merging.first}?`
                        : undefined
              }
              description={
                dialog?.kind === "take_over"
                  ? `${takeOverText} They are told in the app and by email; the stage, due date and updates stay as they are.`
                  : merging
                    ? `${merging.later} closes as a duplicate of ${merging.first}, the first report, which keeps everything. Whoever raised or follows ${merging.later} follows ${merging.first} instead and counts in its tally. There's no undo.`
                    : undefined
              }
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
