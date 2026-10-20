"use client";

import { Bug, FileText, HelpCircle, KeyRound, Lightbulb, Loader2, MessageSquareText, Paperclip, Send, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { BackupForm } from "@/components/chat/backup-form";
import { ConfirmCard } from "@/components/chat/confirm-card";
import { DoneView } from "@/components/chat/done-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  ApiError,
  errorText,
  streamChat,
  type Attachment,
  type ChatCard,
  type ChatStart,
  type Chip,
  type Duplicate,
  type Project,
  type Saved,
} from "@/lib/api";
import { fileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "agent"; text: string; files?: string[] };
type Mode = "starting" | "chat" | "fallback" | "done";

const STARTERS = [
  { icon: Bug, label: "Something's broken", text: "Something's broken: " },
  { icon: KeyRound, label: "I need access", text: "I need access to " },
  { icon: Lightbulb, label: "I have an idea", text: "It would help if " },
  { icon: HelpCircle, label: "How do I…?", text: "How do I " },
];
const ACCEPT = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp";
const POPULAR = ["rake-agent", "staff-admin-portal", "cpd-tracker", "training-portal", "financial-platform"];

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

export function ChatPanel({ projectSlug }: { projectSlug: string | null }) {
  const [mode, setMode] = useState<Mode>("starting");
  const [start, setStart] = useState<ChatStart | null>(null);
  const [project, setProject] = useState<string | null>(projectSlug);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [card, setCard] = useState<{ card: ChatCard; hash: string } | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ saved: Saved; plusOne: boolean } | null>(null);
  const [round, setRound] = useState(0);
  const [context, setContext] = useState<Record<string, string>>({});
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const started = useRef<string | null>(null);

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
  }, [project, round]);

  useEffect(() => {
    // Scroll the message list only, never the page.
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, card, duplicates, chips, busy]);

  const sid = start?.session_id ?? null;
  const userTyped = turns.filter((t) => t.role === "user").map((t) => t.text).join("\n\n");

  const run = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setError(null);
      setChips([]);
      let done: Saved | null = null;
      let fallback = false;
      try {
        await streamChat(path, body, (e) => {
          if (e.type === "message") setTurns((t) => [...t, { role: "agent", text: e.text }]);
          else if (e.type === "chips") setChips(e.options);
          else if (e.type === "duplicates") setDuplicates(e.candidates);
          else if (e.type === "draft") setCard({ card: e.card, hash: e.hash });
          else if (e.type === "done") done = { reference: e.reference, assigned_to: e.assigned_to, status: e.status };
          else if (e.type === "fallback") fallback = true;
        });
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
      if (done) {
        setSaved({ saved: done, plusOne: false });
        setMode("done");
      } else if (fallback) {
        setMode("fallback");
      } else {
        input.current?.focus();
      }
    },
    [],
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
      setSaved({ saved: s, plusOne: true });
      setMode("done");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function attach(list: FileList | null) {
    if (!list || !sid) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(list)) {
      try {
        const att = await api.upload<Attachment>(`/chat/sessions/${sid}/attachments`, file);
        setFiles((f) => [...f, att]);
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function again() {
    setSaved(null);
    setProject(null);
    setRound((r) => r + 1);
  }

  const projects: Project[] = start?.projects ?? [];
  const firstMessage = turns.filter((t) => t.role === "user").length === 0;
  const selected = projects.find((p) => p.slug === project);

  return (
    <section aria-label="Chat with the feedback assistant" className="min-w-0 overflow-hidden rounded-3xl border bg-card shadow-card">
      <header className="flex items-center gap-3 border-b px-5 py-4">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-tint text-brand-text" aria-hidden="true">
          <MessageSquareText className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-bold">Feedback assistant</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", mode === "fallback" ? "bg-warning" : "bg-success")} aria-hidden="true" />
            {mode === "fallback" ? "Assistant offline, the form still works" : "Asks a few questions, then sends it to the right person"}
          </p>
        </div>
      </header>

      {mode === "starting" && (
        <div className="grid gap-3 p-5" aria-busy="true">
          <Skeleton className="h-10 w-2/3 rounded-2xl" />
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
      )}

      {mode === "fallback" && (
        <>
          {error && <p className="px-5 pt-4 text-sm text-destructive" role="alert">{error}</p>}
          <BackupForm
            projects={projects}
            initialProject={project}
            initialDetails={userTyped}
            sessionId={sid}
            context={context}
            onSaved={(s) => {
              setSaved({ saved: s, plusOne: false });
              setMode("done");
            }}
          />
        </>
      )}

      {mode === "done" && saved && <DoneView saved={saved.saved} plusOne={saved.plusOne} onAgain={again} />}

      {mode === "chat" && (
        <>
          <ol ref={list} className="grid max-h-[60vh] min-h-56 content-start gap-3 overflow-y-auto p-5" aria-live="polite">
            {turns.map((t, i) => (
              <li key={i} className={cn("flex animate-fade-up", t.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
                    t.role === "user" ? "rounded-br-md bg-band text-band-foreground" : "rounded-bl-md bg-muted",
                  )}
                >
                  <span className="sr-only">{t.role === "user" ? "You: " : "Assistant: "}</span>
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
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Thinking…
              </li>
            )}
            {firstMessage && !busy && (
              <li className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map(({ icon: Icon, label, text: starter }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setText(starter);
                        input.current?.focus();
                      }}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors hover:border-primary hover:bg-brand-tint"
                    >
                      <Icon className="size-4 text-primary" aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">Which tool is it about? (optional)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {projects
                      .filter((p) => POPULAR.includes(p.slug) || p.slug === project)
                      .map((p) => (
                        <button
                          key={p.slug}
                          type="button"
                          aria-pressed={p.slug === project}
                          onClick={() => setProject(p.slug === project ? null : p.slug)}
                          className={cn(
                            "min-h-9 rounded-full bg-secondary px-3 text-sm font-medium hover:bg-muted",
                            p.slug === project && "bg-primary text-primary-foreground hover:bg-primary",
                          )}
                        >
                          {p.name}
                        </button>
                      ))}
                    <span className="self-center px-1 text-sm text-muted-foreground">or just mention it</span>
                  </div>
                </div>
              </li>
            )}
            {chips.length > 0 && !busy && (
              <li className="flex flex-wrap gap-1.5" aria-label="Quick answers">
                {chips.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => void send(c.value)}
                    className="min-h-11 rounded-full border px-4 text-sm font-medium hover:border-primary hover:bg-brand-tint"
                  >
                    {c.label}
                  </button>
                ))}
              </li>
            )}
            {duplicates.length > 0 && !busy && (
              <li className="rounded-2xl border border-dashed p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" aria-hidden="true" /> Someone may have raised this already
                </p>
                <ul className="mt-2 grid gap-2">
                  {duplicates.map((d) => (
                    <li key={d.reference} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        <span className="font-mono font-semibold">{d.reference}</span> · {d.title}
                      </span>
                      <Button variant="outline" size="lg" className="rounded-xl" onClick={() => void plusOne(d.reference)}>
                        Add my comment there instead
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {card && (
              <li>
                <ConfirmCard card={card.card} busy={busy} onConfirm={() => void confirm()} onChange={change} />
              </li>
            )}
          </ol>

          {error && <p className="px-5 text-sm text-destructive" role="alert">{error}</p>}

          <form onSubmit={onSubmit} className="border-t bg-muted/40 p-3 sm:p-4">
            {(files.length > 0 || selected) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selected && !firstMessage && (
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
              <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" id="chat-files" onChange={(e) => void attach(e.target.files)} />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="size-12 shrink-0 rounded-xl"
                onClick={() => fileInput.current?.click()}
                disabled={busy || uploading || files.length >= 5}
                aria-label="Attach a file (PDF, Word, Excel or image, up to 10 MB)"
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
                disabled={busy}
                placeholder={firstMessage ? "Describe it in your own words" : "Type your reply"}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                className="max-h-40 min-h-12 flex-1 resize-none rounded-xl bg-card py-3 text-base"
              />
              <Button
                type="submit"
                variant={card ? "outline" : "default"}
                className="h-12 shrink-0 rounded-xl px-5 text-base"
                disabled={busy || !text.trim()}
              >
                <Send /> <span className="hidden sm:inline">Send</span>
              </Button>
            </div>
            <p className="mt-2 px-1 text-xs text-muted-foreground">Enter sends, Shift+Enter for a new line. Files: PDF, Word, Excel, images, up to 10 MB.</p>
          </form>
        </>
      )}
    </section>
  );
}
