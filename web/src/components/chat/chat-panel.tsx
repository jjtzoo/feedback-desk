"use client";

import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { BackupForm } from "@/components/chat/backup-form";
import { ConfirmCard } from "@/components/chat/confirm-card";
import { DoneView } from "@/components/chat/done-view";
import { SigAvatar, type SigState } from "@/components/chat/sig-avatar";
import { UsageMeter } from "@/components/chat/usage-meter";
import { DISCLOSURE } from "@/components/staff-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  ApiError,
  errorText,
  streamChat,
  type Allowance,
  type Attachment,
  type ChatCard,
  type ChatStart,
  type Chip,
  type Duplicate,
  type Project,
  type Saved,
  type UsageLimit,
} from "@/lib/api";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "agent"; text: string; files?: string[] };
type Mode = "starting" | "chat" | "fallback" | "done";

const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp";

function captureContext(): Record<string, string> {
  const ua = navigator.userAgent;
  const device = /iPhone|iPad|Android|Mobile/i.test(ua) ? (/iPad|Tablet/i.test(ua) ? "Tablet" : "Phone") : "Desktop";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Other";
  const params = new URLSearchParams(window.location.search);
  return {
    browser: `${browser} on ${navigator.platform || "unknown"}`.slice(0, 200),
    device,
    screen: `${window.screen.width}x${window.screen.height}`,
    source: (params.get("from") ?? document.referrer ?? "").slice(0, 500) || "Feedback page",
    time: new Date().toString().slice(0, 60),
  };
}

export function ChatPanel({ projectSlug, starterText }: { projectSlug: string | null; starterText?: string }) {
  const [mode, setMode] = useState<Mode>("starting");
  const [start, setStart] = useState<ChatStart | null>(null);
  const [project, setProject] = useState<string | null>(projectSlug);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [card, setCard] = useState<{ card: ChatCard; hash: string } | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState(starterText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ saved: Saved; plusOne: boolean } | null>(null);
  const [round, setRound] = useState(0);
  const [context, setContext] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<UsageLimit | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const started = useRef<string | null>(null);

  const refreshAllowance = useCallback(() => {
    api.get<Allowance>("/usage/me").then(setAllowance).catch(() => undefined);
  }, []);

  useEffect(() => {
    const key = `${round}:${project ?? ""}`;
    if (started.current === key) return; // one session per visit, even if effects run twice
    started.current = key;
    const ctx = captureContext();
    setContext(ctx);
    setMode("starting");
    setTurns([]);
    setChips([]);
    setDuplicates([]);
    setCard(null);
    setFiles([]);
    setError(null);
    api
      .post<ChatStart>("/chat/sessions", { project_slug: project, context: ctx })
      .then((s) => {
        setStart(s);
        setLimit(s.limit);
        refreshAllowance();
        if (s.mode === "fallback" || !s.session_id) {
          setMode("fallback");
          return;
        }
        setTurns([{ role: "agent", text: s.greeting ?? "What's on your mind?" }]);
        setMode("chat");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 429) setError(e.message);
        setMode("fallback");
      });
  }, [project, round, refreshAllowance]);

  useEffect(() => {
    // Scroll the message list only, never the page.
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, card, duplicates, chips, busy]);

  // Arriving from a start card: put the cursor in the box so the user can finish the sentence.
  useEffect(() => {
    if (mode === "chat" && starterText) input.current?.focus();
  }, [mode, starterText]);

  // When the confirm card appears, move focus to it so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (card) document.getElementById("confirm-title")?.focus();
  }, [card]);

  const sid = start?.session_id ?? null;
  const userTyped = turns.filter((t) => t.role === "user").map((t) => t.text).join("\n\n");

  const finish = useCallback((s: Saved, plusOne: boolean) => {
    setSaved({ saved: s, plusOne });
    setMode("done");
  }, []);

  const run = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setError(null);
      setFailed(false);
      setChips([]);
      let done: Saved | null = null;
      let fallback = false;
      let drafted = false;
      try {
        await streamChat(path, body, (e) => {
          if (e.type === "message") setTurns((t) => [...t, { role: "agent", text: e.text }]);
          else if (e.type === "chips") setChips(e.options);
          else if (e.type === "duplicates") setDuplicates(e.candidates);
          else if (e.type === "draft") {
            drafted = true;
            setCard({ card: e.card, hash: e.hash });
          }
          else if (e.type === "done") done = { reference: e.reference, assigned_to: e.assigned_to, status: e.status };
          else if (e.type === "fallback") {
            fallback = true;
            setFallbackReason(e.reason);
          }
        });
      } catch (e) {
        setError(errorText(e));
        setFailed(true);
      } finally {
        setBusy(false);
        refreshAllowance();
      }
      if (done) {
        finish(done, false);
      } else if (fallback) {
        setMode("fallback");
      } else if (!drafted) {
        input.current?.focus();
      }
    },
    [refreshAllowance, finish],
  );

  async function send(message: string) {
    const clean = message.trim();
    if (!clean || busy || !sid) return;
    setText("");
    setCard(null);
    const attached = files;
    setFiles([]);
    setTurns((t) => [...t, { role: "user", text: clean, files: attached.map((f) => f.file_name) }]);
    await run(`/chat/sessions/${sid}/messages`, { text: clean, attachment_ids: attached.map((f) => f.id) });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  async function confirm() {
    if (card && sid) await run(`/chat/sessions/${sid}/confirm`, { draft_hash: card.hash });
  }

  function change() {
    setCard(null);
    setTurns((t) => [...t, { role: "agent", text: "No worries. What should I change?" }]);
    input.current?.focus();
  }

  async function plusOne(reference: string) {
    if (!sid) return;
    setBusy(true);
    try {
      const s = await api.post<Saved>(`/chat/sessions/${sid}/plus-one`, { reference, comment: userTyped });
      finish(s, true);
    } catch (e) {
      setError(errorText(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const maxFiles = start?.max_files ?? 5;
  const maxMb = start?.max_file_mb ?? 10;

  /** From the paperclip or a drop. Size and count are checked here first so a refusal is instant;
   *  the API checks type, contents, size and count again. */
  async function attach(list: FileList | null) {
    if (!list || !sid) return;
    setUploading(true);
    setError(null);
    let count = files.length;
    for (const file of Array.from(list)) {
      if (count >= maxFiles) {
        setError(`Up to ${maxFiles} files per feedback.`);
        break;
      }
      if (file.size > maxMb * 1024 * 1024) {
        setError(`${file.name}: Files can be up to ${maxMb} MB.`);
        continue;
      }
      try {
        const att = await api.upload<Attachment>(`/chat/sessions/${sid}/attachments`, file);
        setFiles((f) => [...f, att]);
        count += 1;
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function again() {
    setSaved(null);
    setFallbackReason(null);
    setProject(null);
    setRound((r) => r + 1);
  }

  const projects: Project[] = start?.projects ?? [];
  const firstMessage = turns.filter((t) => t.role === "user").length === 0;
  const selected = projects.find((p) => p.slug === project);
  const sig: SigState = mode === "fallback" ? "offline" : mode === "done" ? "sent" : failed ? "error" : "ready";

  return (
    <section aria-label="Chat with Sig, the feedback assistant" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-5 pb-1 sm:px-6">
        <SigAvatar state={sig} className="size-10" />
        <div>
          <p className="flex items-center gap-2 font-bold">
            Sig <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">AI</span>
          </p>
          <p className="text-sm text-muted-foreground">{sig === "offline" ? "Not available right now" : "Smoke Signal's feedback assistant"}</p>
        </div>
      </header>

      {mode === "starting" && (
        <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 py-5 sm:px-6" aria-busy="true">
          <Skeleton className="h-10 w-2/3 rounded-2xl" />
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
      )}

      {mode === "fallback" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl">
            {error && <p className="px-5 pt-4 text-sm text-destructive" role="alert">{error}</p>}
            <BackupForm
              projects={projects}
              initialProject={project}
              initialDetails={userTyped}
              limit={limit}
              reason={fallbackReason}
              sessionId={sid}
              context={context}
              onSaved={(s) => finish(s, false)}
            />
          </div>
        </div>
      )}

      {mode === "done" && saved && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl">
            <DoneView saved={saved.saved} plusOne={saved.plusOne} onAgain={again} />
          </div>
        </div>
      )}

      {mode === "chat" && (
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            if (!busy && !uploading) void attach(e.dataTransfer.files);
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-card/90 text-sm font-semibold">
              Drop files to attach (up to {maxFiles}, {maxMb} MB each)
            </div>
          )}
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
            <ol className="mx-auto grid w-full max-w-3xl content-start gap-3 px-4 py-5 sm:px-6" aria-live="polite">
              {turns.map((t, i) => (
                <li key={i} className={cn("flex animate-fade-up", t.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
                      t.role === "user" ? "rounded-br-md bg-band text-band-foreground" : "rounded-bl-md bg-muted",
                    )}
                  >
                    <span className="sr-only">{t.role === "user" ? "You: " : "Sig: "}</span>
                    {t.text}
                    {t.files && t.files.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {t.files.map((f) => (
                          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs">
                            <FileText className="size-3" aria-hidden="true" /> {f}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </li>
              ))}
              {busy && (
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <SigAvatar state="writing" className="size-7 animate-pulse" />
                  Sig is writing…
                </li>
              )}
              {chips.length > 0 && !busy && (
                <li className="grid gap-2" aria-label="Quick answers">
                  {/* The person's likely tools first, under their own label (D60). */}
                  {chips.some((c) => c.usual) && (
                    <div className="grid gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Your usual tools</p>
                      <ChipRow chips={chips.filter((c) => c.usual)} onPick={(v) => void send(v)} />
                    </div>
                  )}
                  <ChipRow chips={chips.filter((c) => !c.usual)} onPick={(v) => void send(v)} />
                </li>
              )}
              {duplicates.length > 0 && !busy && (
                <li className="rounded-2xl border border-dashed p-4">
                  <p className="text-sm font-semibold">Someone may have raised this already</p>
                  <ul className="mt-2 grid gap-2">
                    {duplicates.map((d) => (
                      <li key={d.reference} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm">
                          <span className="font-mono font-semibold">{d.reference}</span> · {d.title}
                        </span>
                        <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={() => void plusOne(d.reference)}>
                          Add my comment there instead
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {card && (
                <li>
                  <ConfirmCard card={card.card} busy={busy} onConfirm={() => void confirm()} onChange={change} onAdd={(detail) => void send(detail)} />
                </li>
              )}
            </ol>
          </div>

          <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-5">
            {error && <p className="px-2 pb-2 text-sm text-destructive" role="alert">{error}</p>}
            <div className="rounded-3xl border bg-card p-2 shadow-card has-[textarea:focus]:outline-3 has-[textarea:focus]:outline-offset-2 has-[textarea:focus]:outline-ring">
              {(files.length > 0 || selected) && (
                <div className="flex flex-wrap gap-1.5 px-2 pt-1 pb-2">
                  {selected && (
                    <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium">About {selected.name}</span>
                  )}
                  {files.map((f) => (
                    <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1 pl-3 text-xs">
                      <FileText className="size-3.5" aria-hidden="true" /> {f.file_name} · {fileSize(f.size_bytes)}
                      <button
                        type="button"
                        onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}
                        className="grid size-6 place-items-center rounded-full hover:bg-muted"
                        aria-label={`Don't send ${f.file_name}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" id="chat-files" tabIndex={-1} onChange={(e) => void attach(e.target.files)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="size-12 shrink-0 rounded-2xl"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || uploading || files.length >= maxFiles}
                  aria-label={`Attach a file (PDF, Word, Excel or image, up to ${maxMb} MB), or drop files on the chat`}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Paperclip className="size-5" />}
                </Button>
                <label htmlFor="chat-message" className="sr-only">
                  Your message
                </label>
                <Textarea
                  id="chat-message"
                  ref={input}
                  rows={1}
                  maxLength={2000}
                  value={text}
                  readOnly={busy}
                  aria-busy={busy}
                  placeholder={firstMessage ? "Describe it in your own words" : "Type your reply"}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="max-h-48 min-h-12 flex-1 resize-none border-0 bg-transparent py-3 text-base shadow-none focus-visible:ring-0 focus-visible:outline-none"
                />
                <Button
                  type="submit"
                  variant={card ? "outline" : "default"}
                  className="h-12 shrink-0 rounded-2xl px-5 text-base"
                  disabled={busy || !text.trim()}
                >
                  <Send /> <span className="sr-only sm:not-sr-only">Send</span>
                </Button>
              </div>
            </div>
            {firstMessage && (
              <p className="mt-2 px-2 text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line. Drop files here to attach them.</p>
            )}
            {allowance && <UsageMeter allowance={allowance} />}
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              Looking for an update on something you already sent?{" "}
              <Link href="/my" className="font-semibold text-foreground underline underline-offset-4">
                Open My feedback
              </Link>
            </p>
            <p className="mt-1 px-2 text-xs text-muted-foreground">{DISCLOSURE}</p>
          </form>
        </div>
      )}
    </section>
  );
}

function ChipRow({ chips, onPick }: { chips: Chip[]; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button key={c.value} type="button" onClick={() => onPick(c.value)} className="min-h-11 rounded-full border px-4 text-sm font-medium hover:bg-muted">
          {c.label}
        </button>
      ))}
    </div>
  );
}
