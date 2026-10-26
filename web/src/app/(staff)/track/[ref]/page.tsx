"use client";

import { Bell, BellOff, Check, FileText, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PriorityBadge } from "@/components/badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorText, type Tracker } from "@/lib/api";
import { day, fileSize, initials, isSettled, when } from "@/lib/format";
import { cn } from "@/lib/utils";

const PREVIEW_ENTRIES = 4;

/** The parcel-style tracker (brief §4.2): status up top, a five-stage stepper, who has it,
 *  the latest update, and the full history newest first. When the owner asks them to try it,
 *  that comes first with It's fixed and Still happening (D80). A notification about news opens
 *  it at #latest (D81). */
export default function TrackerPage() {
  const { ref } = useParams<{ ref: string }>();
  const [t, setT] = useState<Tracker | null>(null);
  const [error, setError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [answering, setAnswering] = useState<"fixed" | "still" | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // Only the skeleton renders before the item loads, so reading the address here can't upset hydration.
  const [pointed, setPointed] = useState(() => typeof window !== "undefined" && window.location.hash === "#latest");

  const load = useCallback(() => {
    api
      .get<Tracker>(`/feedback/${ref}/tracker`)
      .then((data) => {
        setT(data);
        document.title = `${data.reference}: ${data.status_text} · Smoke Signal`;
      })
      .catch((e: unknown) => setError({ notFound: e instanceof ApiError && e.status === 404, text: errorText(e) }));
  }, [ref]);
  useEffect(load, [load]);

  // Opened from a notification about news: bring Latest update into view once it has loaded, marked for a moment.
  const loaded = t !== null;
  useEffect(() => {
    if (!loaded || window.location.hash !== "#latest") return;
    document.getElementById("latest")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setPointed(false), 2500);
    return () => clearTimeout(timer);
  }, [loaded]);

  async function answer(fixed: boolean) {
    setAnswering(fixed ? "fixed" : "still");
    setAnswerError(null);
    try {
      setT(await api.post<Tracker>(`/feedback/${ref}/check`, { fixed, comment }));
      setComment("");
      toast.success(fixed ? "Thanks. The owner has been told it's fixed." : "Thanks. It's back with the owner.");
    } catch (err) {
      setAnswerError(errorText(err, "We couldn't send that. Please try again."));
    } finally {
      setAnswering(null);
    }
  }

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      setT(await api.post<Tracker>(`/feedback/${ref}/replies`, { body: reply }));
      setReply("");
      toast.success("Added. The owner has been told.");
    } catch (err) {
      setSendError(errorText(err, "We couldn't send that. Your reply is still here, so you can try again."));
    } finally {
      setSending(false);
    }
  }

  async function toggleMute() {
    if (!t) return;
    setMuteError(null);
    try {
      await api.post(`/feedback/${ref}/mute`, { muted: !t.muted });
      setT({ ...t, muted: !t.muted });
      toast.success(t.muted ? "Notifications are back on for this item." : "Muted. You won't get updates for this item.");
    } catch (err) {
      setMuteError(errorText(err, "We couldn't change that. Please try again."));
    }
  }

  if (error?.notFound) {
    return (
      <div className="mx-auto grid max-w-lg justify-items-center gap-3 px-4 py-24 text-center">
        <h1 className="text-2xl font-extrabold">We can&apos;t find that feedback</h1>
        <p className="text-muted-foreground">Check the reference, or open it from My feedback.</p>
        <Button asChild variant="outline" className="h-11 rounded-xl">
          <Link href="/my">Go to My feedback</Link>
        </Button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error.text}
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => {
                setError(null);
                load();
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!t) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4 px-4 py-10" aria-busy="true">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  const history = showAll ? t.history : t.history.slice(0, PREVIEW_ENTRIES);
  return (
    <div className="pb-12">
      {/* Mockup E: charcoal status band with red highlights. */}
      <section className="bg-band text-band-foreground">
        <div className="mx-auto max-w-4xl px-4 pt-8 pb-20 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-band-muted">
            <Link href="/my" className="inline-flex min-h-11 items-center rounded hover:text-band-foreground">
              My feedback
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-band-foreground">{t.reference}</span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{t.status_text}</h1>
          {t.expected_by && <p className="mt-1 text-lg text-band-foreground">Expected by {day(t.expected_by)}</p>}
          <p className="mt-2 text-band-muted">
            {[t.project ?? "Tool to confirm", t.category].filter(Boolean).join(" · ")}
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-12 grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-6 px-4 sm:px-6">
        <section className="rounded-3xl border bg-card p-5 shadow-card sm:p-6" aria-label="Progress">
          <ol className="grid grid-cols-5 gap-1">
            {t.stages.map((s, i) => (
              <li key={s.key} className="relative grid justify-items-center gap-2 text-center">
                {i > 0 && (
                  <span
                    className={cn("absolute top-4 right-1/2 h-1 w-full -translate-y-1/2", s.state === "todo" ? "bg-border" : "bg-primary")}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "relative grid size-8 place-items-center rounded-full border-2",
                    s.state === "done" && "border-primary bg-primary text-primary-foreground",
                    s.state === "current" && "border-primary bg-card ring-4 ring-primary/20",
                    s.state === "todo" && "border-border bg-card",
                  )}
                  title={s.at ? when(s.at) : undefined}
                >
                  {s.state === "done" && <Check className="size-4" aria-hidden="true" />}
                  {s.state === "current" && <span className="size-3 rounded-full bg-primary" aria-hidden="true" />}
                </span>
                <span className={cn("text-xs sm:text-sm", s.state === "current" ? "font-bold" : "text-muted-foreground")}>
                  {s.label}
                  <span className="sr-only">{s.state === "done" ? ", done" : s.state === "current" ? ", current stage" : ", not yet"}</span>
                </span>
                {s.at && <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">{day(s.at)}</span>}
              </li>
            ))}
          </ol>
          {(t.close_reason || t.merged_into) && (
            <p className="mt-5 rounded-2xl bg-muted p-4 text-sm">
              {t.merged_into ? (
                <>
                  Same request as{" "}
                  <Link className="font-mono font-semibold underline" href={`/track/${t.merged_into}`}>
                    {t.merged_into}
                  </Link>
                  . Follow that one for updates.
                </>
              ) : (
                <>Reason: {t.close_reason}</>
              )}
            </p>
          )}
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="who">
              <h2 id="who" className="text-sm font-semibold text-muted-foreground">
                Who has it
              </h2>
              {t.assignee ? (
                <div className="mt-3 flex items-center gap-3">
                  <Avatar className="size-11">
                    <AvatarFallback className="bg-muted font-bold">{initials(t.assignee.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.assignee.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{t.assignee.role}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">The Digital team is checking who it belongs to.</p>
              )}
            </section>

            <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="what">
              <h2 id="what" className="text-sm font-semibold text-muted-foreground">
                What you sent
              </h2>
              <p className="mt-2 font-semibold">{t.title}</p>
              {t.summary !== t.title && <p className="mt-1 text-sm text-muted-foreground">{t.summary}</p>}
              <PriorityBadge priority={t.priority} quiet={isSettled(t.status)} className="mt-3 flex w-fit" />
              {t.attachments.length > 0 && (
                <ul className="mt-4 grid gap-1.5">
                  {t.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md text-sm underline-offset-4 hover:underline">
                        <FileText className="size-4" aria-hidden="true" /> {a.file_name} · {fileSize(a.size_bytes)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Button variant="ghost" className="h-auto min-h-11 justify-start rounded-xl text-left whitespace-normal" onClick={() => void toggleMute()}>
              {t.muted ? <BellOff /> : <Bell />}
              {t.muted ? "Unmute this item" : "Mute notifications for this item"}
            </Button>
            {muteError && (
              <p className="text-sm text-destructive" role="alert">
                {muteError}
              </p>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            {t.check && (
              <section id="latest" className={cn("rounded-3xl border-2 border-foreground bg-card p-5 shadow-card transition-shadow", pointed && "ring-2 ring-ring")} aria-labelledby="check">
                <h2 id="check" className="font-semibold">
                  {t.check.by ?? "The team"} asked you to check this
                </h2>
                <p className="mt-2 whitespace-pre-wrap">{t.check.body}</p>
                <p className="mt-2 text-sm text-muted-foreground">{when(t.check.at)}</p>
                <label htmlFor="check-comment" className="mt-4 block text-sm font-medium">
                  Comment (optional)
                </label>
                <Textarea id="check-comment" rows={2} value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} className="mt-1 rounded-xl text-base" />
                {answerError && (
                  <p className="mt-2 text-sm text-destructive" role="alert">
                    {answerError}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="h-11 rounded-xl px-5" disabled={answering !== null} onClick={() => void answer(true)}>
                    {answering === "fixed" ? <Loader2 className="animate-spin" /> : <Check />} It&apos;s fixed
                  </Button>
                  <Button variant="outline" className="h-11 rounded-xl px-5" disabled={answering !== null} onClick={() => void answer(false)}>
                    {answering === "still" && <Loader2 className="animate-spin" />} Still happening
                  </Button>
                </div>
              </section>
            )}

            {t.latest_update && t.latest_update.at !== t.check?.at && (
              <section id={t.check ? undefined : "latest"} className={cn("rounded-3xl border bg-card p-5 shadow-card transition-shadow", pointed && !t.check && "ring-2 ring-ring")} aria-labelledby="latest-heading">
                <h2 id="latest-heading" className="text-sm font-semibold text-muted-foreground">
                  Latest update
                </h2>
                <p className="mt-2 whitespace-pre-wrap">{t.latest_update.body}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.latest_update.author} · {when(t.latest_update.at)}
                </p>
              </section>
            )}

            <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="history">
              <h2 id="history" className="text-sm font-semibold text-muted-foreground">
                Tracking history
              </h2>
              <ol className="mt-4">
                {history.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="relative grid grid-cols-[1.25rem_1fr] gap-3 pb-5 last:pb-0">
                    {i < history.length - 1 && <span className="absolute top-4 left-[9px] h-full w-0.5 bg-border" aria-hidden="true" />}
                    <span
                      className={cn("relative mt-1 size-[18px] rounded-full border-4 border-card", i === 0 ? "bg-foreground" : "bg-muted-foreground/40")}
                      aria-hidden="true"
                    />
                    <div className={cn(i > 0 && "text-muted-foreground")}>
                      <p className={cn(i === 0 && "font-semibold")}>{h.text}</p>
                      {h.detail && h.detail !== h.text && <p className="mt-1 text-sm whitespace-pre-wrap">{h.detail}</p>}
                      <time dateTime={h.at} className="font-mono text-xs tabular">
                        {when(h.at)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
              {t.history.length > PREVIEW_ENTRIES && (
                <Button variant="link" className="mt-2 h-auto min-h-11 px-0" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show less" : `See full history (${t.history.length})`}
                </Button>
              )}
            </section>

            {t.can_reply && (
              <form onSubmit={sendReply} className="rounded-3xl border bg-card p-5 shadow-card">
                <label htmlFor="reply" className="text-sm font-semibold">
                  Reply or add details
                </label>
                <p className="text-sm text-muted-foreground">
                  {t.stage === "resolved" ? "Still not right? Replying reopens it." : "The owner is notified straight away."}
                </p>
                <Textarea id="reply" rows={3} value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} className="mt-3 rounded-xl text-base" />
                {sendError && (
                  <p className="mt-2 text-sm text-destructive" role="alert">
                    {sendError}
                  </p>
                )}
                <Button type="submit" className="mt-3 h-11 rounded-xl px-5" disabled={sending || !reply.trim()}>
                  {sending ? <Loader2 className="animate-spin" /> : <Send />} Send
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
