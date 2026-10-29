"use client";

import { ExternalLink, Loader2, Paperclip, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ACCEPT, FileThumbs, PhotoButton, ScreenshotNote, isImage, pastedImages, preview, withinLimits, type Shown } from "@/components/attach";
import { AppCards } from "@/components/chat/app-cards";
import { BackupForm } from "@/components/chat/backup-form";
import { ConfirmCard } from "@/components/chat/confirm-card";
import { DoneView } from "@/components/chat/done-view";
import { SigAvatar, type SigState } from "@/components/chat/sig-avatar";
import { UsageMeter } from "@/components/chat/usage-meter";
import { DISCLOSURE } from "@/components/chat/disclosure";
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
  type ChatResume,
  type ChatStart,
  type Chip,
  type Duplicate,
  type Project,
  type Saved,
  type UsageLimit,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "agent"; text: string; files?: Shown[] };
type Mode = "starting" | "chat" | "fallback" | "done";

/** The chat in progress in this tab, so a refresh picks it up again. The API only returns the
 *  signed-in person's own chat, and none once it is sent. */
const CHAT_KEY = "sig-chat";
type Remembered = { sid: string; project: string | null };

function remembered(): Remembered | null {
  try {
    const raw = window.sessionStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as Remembered) : null;
  } catch {
    return null;
  }
}

function remember(value: Remembered | null) {
  try {
    if (value) window.sessionStorage.setItem(CHAT_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(CHAT_KEY);
  } catch {
    // Storage blocked: the chat still works, it just won't survive a refresh.
  }
}

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
  // Local previews of images waiting to be sent, by attachment id; they stay on the sent message.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Shown[]>([]);
  // The tool, once chosen on a card, passed by ?project= or named in the chat; the cards go then (D99).
  const [tool, setTool] = useState<string | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
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
  const warned = useRef(false);

  const refreshAllowance = useCallback(() => {
    api.get<Allowance>("/usage/me").then(setAllowance).catch(() => undefined);
  }, []);

  // Near the limit, Sig says once per chat that this report still finishes (D36), so nobody is caught short.
  useEffect(() => {
    if (mode !== "chat" || warned.current || !allowance?.limit_tokens || allowance.percent < 80) return;
    warned.current = true;
    const used = allowance.percent >= 100 ? "used today's allowance" : `used ${allowance.percent}% of today's allowance`;
    setTurns((t) => [
      ...t,
      {
        role: "agent",
        text: `Quick heads-up: you've ${used} with me. We'll still finish this report, so nothing's lost. Anything new after the allowance runs out goes through a short form until tomorrow.`,
      },
    ]);
  }, [mode, allowance]);

  useEffect(() => {
    const key = `${round}:${project ?? ""}`;
    if (started.current === key) return; // one session per visit, even if effects run twice
    started.current = key;
    const ctx = captureContext();
    setContext(ctx);
    setMode("starting");
    warned.current = false;
    setTurns([]);
    setChips([]);
    setDuplicates([]);
    setCard(null);
    setFiles([]);
    setSent([]);
    setError(null);
    const begin = () =>
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
          remember({ sid: s.session_id, project });
          setTurns([{ role: "agent", text: s.greeting ?? "What's on your mind?" }]);
          setTool(s.project?.slug ?? null);
          setCardsOpen(!s.project);
          setMode("chat");
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 429) setError(e.message);
          setMode("fallback");
        });
    // A refresh picks the chat up again; a sent or ended one starts fresh.
    const last = round === 0 ? remembered() : null;
    if (!last || last.project !== project) {
      remember(null);
      void begin();
      return;
    }
    api
      .get<ChatResume>(`/chat/sessions/${last.sid}`)
      .then((r) => {
        setStart(r);
        refreshAllowance();
        // Files come back by name; the chat's attachments give each one its thumbnail (D95).
        const byName = new Map(r.attachments.map((a) => [a.file_name, a]));
        const shown = (names: string[]): Shown[] =>
          names.map((name) => {
            const a = byName.get(name);
            return { key: a?.id ?? name, name, size: a?.size_bytes, src: a && isImage(a.mime_type) ? `/api/files/${a.id}` : null };
          });
        setTurns(r.turns.map((turn) => ({ ...turn, files: turn.files.length ? shown(turn.files) : undefined })));
        setSent(r.turns.flatMap((turn) => shown(turn.files)));
        setTool(r.tool);
        setCardsOpen(!r.tool);
        setDuplicates(r.duplicates);
        setCard(r.card && r.card_hash ? { card: r.card, hash: r.card_hash } : null);
        setText("");
        setMode("chat");
      })
      .catch(() => {
        remember(null);
        void begin();
      });
  }, [project, round, refreshAllowance]);

  useEffect(() => {
    // Scroll the message list only, never the page; a new chat stays at the greeting and the cards.
    const el = list.current;
    if (el && turns.length > 1) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
    remember(null);
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
          else if (e.type === "tool") {
            setTool(e.slug);
            setCardsOpen(false);
          } else if (e.type === "chips") {
            setChips(e.options);
            // The tool chips under Sig's question take over from the cards.
            if (e.kind === "project") setCardsOpen(false);
          }
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
    const shown = pending;
    setFiles([]);
    setSent((s) => [...s, ...shown]);
    setTurns((t) => [...t, { role: "user", text: clean, files: shown }]);
    await run(`/chat/sessions/${sid}/messages`, { text: clean, attachment_ids: attached.map((f) => f.id) });
  }

  /** An app card: code sets the tool and Sig answers its name like a message (D99). */
  async function pickTool(p: Project) {
    if (busy || !sid) return;
    setCardsOpen(false);
    setTool(p.slug);
    setCard(null);
    setTurns((t) => [...t, { role: "user", text: p.name }]);
    await run(`/chat/sessions/${sid}/tool`, { project_slug: p.slug });
  }

  function somethingElse() {
    setCardsOpen(false);
    input.current?.focus();
  }

  function pick(chip: Chip) {
    if (chip.own_words) input.current?.focus();
    else void send(chip.value);
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

  /** From the paperclip, a drop, a paste or the camera. Size and count are checked here first so a
   *  refusal is instant; the API checks type, contents, size and count again. */
  async function attach(picked: File[]) {
    if (picked.length === 0 || !sid) return;
    const { ok, error: refused } = withinLimits(picked, files.length, maxFiles, maxMb);
    setError(refused);
    setUploading(true);
    for (const file of ok) {
      try {
        const att = await api.upload<Attachment>(`/chat/sessions/${sid}/attachments`, file);
        const src = preview(file);
        if (src) setPreviews((p) => ({ ...p, [att.id]: src }));
        setFiles((f) => [...f, att]);
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function unattach(id: string) {
    setFiles((all) => all.filter((x) => x.id !== id));
    if (previews[id]) URL.revokeObjectURL(previews[id]);
  }

  function again() {
    Object.values(previews).forEach((src) => URL.revokeObjectURL(src));
    setPreviews({});
    remember(null);
    setSaved(null);
    setFallbackReason(null);
    setProject(null);
    setRound((r) => r + 1);
  }

  const projects: Project[] = start?.projects ?? [];
  const firstMessage = turns.filter((t) => t.role === "user").length === 0;
  const selected = projects.find((p) => p.slug === tool);
  const pending: Shown[] = files.map((f) => ({ key: f.id, name: f.file_name, size: f.size_bytes, src: previews[f.id] ?? null }));
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
        {mode === "chat" && !firstMessage && (
          <Button variant="ghost" className="ml-auto h-11 rounded-xl" onClick={again} disabled={busy}>
            <RotateCcw aria-hidden="true" /> New chat
          </Button>
        )}
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
            if (!busy && !uploading) void attach(Array.from(e.dataTransfer.files));
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
                <Fragment key={i}>
                  <li className={cn("flex animate-fade-up", t.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
                        t.role === "user" ? "rounded-br-md bg-band text-band-foreground" : "rounded-bl-md bg-muted",
                      )}
                    >
                      <span className="sr-only">{t.role === "user" ? "You: " : "Sig: "}</span>
                      {t.text}
                      {t.files && <FileThumbs files={t.files} className="mt-2" />}
                    </div>
                  </li>
                  {i === 0 && cardsOpen && (
                    <li>
                      <AppCards projects={projects} usual={start?.usual ?? []} disabled={busy} onPick={(p) => void pickTool(p)} onElse={somethingElse} />
                    </li>
                  )}
                </Fragment>
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
                      <ChipRow chips={chips.filter((c) => c.usual)} onPick={pick} />
                    </div>
                  )}
                  <ChipRow chips={chips.filter((c) => !c.usual)} onPick={pick} />
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
                        <span className="flex flex-wrap gap-2">
                          {/* A new tab, so the chat stays as it is; the item opens as general information (D97). */}
                          <Button asChild variant="ghost" size="lg" className="h-11 rounded-xl">
                            <Link href={`/track/${d.reference}`} target="_blank" rel="noopener">
                              View it <ExternalLink aria-hidden="true" />
                              <span className="sr-only">(opens in a new tab)</span>
                            </Link>
                          </Button>
                          <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={() => void plusOne(d.reference)}>
                            Add my comment there instead
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {card && (
                <li>
                  <ConfirmCard card={card.card} files={sent} busy={busy} onConfirm={() => void confirm()} onChange={change} onAdd={(detail) => void send(detail)} />
                </li>
              )}
            </ol>
          </div>

          <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-5">
            {error && <p className="px-2 pb-2 text-sm text-destructive" role="alert">{error}</p>}
            <div className="rounded-3xl border bg-card p-2 shadow-card has-[textarea:focus]:outline-3 has-[textarea:focus]:outline-offset-2 has-[textarea:focus]:outline-ring">
              {(files.length > 0 || selected) && (
                <div className="grid gap-2 px-2 pt-2 pb-2">
                  {selected && (
                    <span className="inline-flex w-fit items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium">About {selected.name}</span>
                  )}
                  <FileThumbs files={pending} onRemove={unattach} />
                  <ScreenshotNote files={pending} />
                </div>
              )}
              <div className="flex items-end gap-1 sm:gap-2">
                <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" id="chat-files" tabIndex={-1} onChange={(e) => void attach(Array.from(e.target.files ?? []))} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="size-12 shrink-0 rounded-2xl"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || uploading || files.length >= maxFiles}
                  aria-label={`Attach a file (PDF, Word, Excel or image, up to ${maxMb} MB), or paste or drop one on the chat`}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Paperclip className="size-5" />}
                </Button>
                <PhotoButton iconOnly className="size-12 shrink-0 rounded-2xl" disabled={busy || uploading || files.length >= maxFiles} onFiles={(f) => void attach(f)} />
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
                  onPaste={(e) => {
                    const images = pastedImages(e);
                    if (images.length === 0) return;
                    e.preventDefault();
                    if (!busy && !uploading) void attach(images);
                  }}
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
              <p className="mt-2 px-2 text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line. Paste a screenshot or drop files here to attach them.</p>
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

function ChipRow({ chips, onPick }: { chips: Chip[]; onPick: (chip: Chip) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <button key={c.value} type="button" onClick={() => onPick(c)} className="min-h-11 rounded-full border px-4 text-sm font-medium hover:bg-muted">
          {c.label}
        </button>
      ))}
    </div>
  );
}
