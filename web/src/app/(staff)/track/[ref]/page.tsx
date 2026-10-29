"use client";

import { Bell, BellOff, Loader2, Paperclip, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ActivityThread, ThreadPeople, type ThreadEntry } from "@/components/activity-thread";
import { ACCEPT, FileThumbs, PhotoButton, ScreenshotNote, isImage, pastedImages, preview, withinLimits, type Shown } from "@/components/attach";
import { PriorityBadge } from "@/components/badges";
import { GeneralView } from "@/components/general-view";
import { IsItFixed } from "@/components/is-it-fixed";
import { useMe } from "@/components/me";
import { StageStepper } from "@/components/stage-stepper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorText, type Attachment, type GeneralItem, type Tracker, type TrackerFile } from "@/lib/api";
import { day, isSettled } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Files already on the item, with images as thumbnails that open the full file (D95). */
function shownFiles(files: TrackerFile[]): Shown[] {
  return files.map((a) => {
    const href = `/api/files/${a.id}`;
    return { key: a.id, name: a.file_name, size: a.size_bytes, src: isImage(a.mime_type) ? href : null, href };
  });
}

/** The parcel-style tracker (brief §4.2): status up top, a five-stage stepper, then the conversation with
 *  whoever has it and the approver: one Conversation, oldest first, Sig's words on each move among the
 *  messages, the message box at the bottom, straight on the page (D105). A resolved item asks the person
 *  who raised it Is it fixed? (D92). A notification about news opens it at the newest entry (#latest,
 *  D81). Anyone else, followers included, gets general information about it instead (D97). */
export default function TrackerPage() {
  const { ref } = useParams<{ ref: string }>();
  const me = useMe();
  const [t, setT] = useState<Tracker | null>(null);
  const [general, setGeneral] = useState<GeneralItem | null>(null);
  const [error, setError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  // The comment box is one line until they use it.
  const [writing, setWriting] = useState(false);
  // Only the skeleton renders before the item loads, so reading the address here can't upset hydration.
  const [pointed, setPointed] = useState(() => typeof window !== "undefined" && window.location.hash === "#latest");
  // Files to send with the reply, each with a local preview if it's an image.
  const [adding, setAdding] = useState<{ file: File; src: string | null }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const shown = (data: { reference: string; status_text: string }) => {
      document.title = `${data.reference}: ${data.status_text} · Smoke Signal`;
    };
    const failed = (e: unknown) => setError({ notFound: e instanceof ApiError && e.status === 404, text: errorText(e) });
    api
      .get<Tracker>(`/feedback/${ref}/tracker`)
      .then((data) => {
        setT(data);
        shown(data);
      })
      .catch((e: unknown) => {
        // Not theirs: the API decides what else they may see (D97).
        if (!(e instanceof ApiError && e.status === 404)) return failed(e);
        api
          .get<GeneralItem>(`/feedback/${ref}/general`)
          .then((data) => {
            setGeneral(data);
            shown(data);
          })
          .catch(failed);
      });
  }, [ref]);
  useEffect(load, [load]);

  /** From the paperclip, a paste or the camera. Size and count are checked here; the API checks again. */
  function pick(files: File[]) {
    if (!t || files.length === 0) return;
    const { ok, error } = withinLimits(files, t.attachments.length + adding.length, t.max_files, t.max_file_mb);
    setSendError(error);
    setAdding((a) => [...a, ...ok.map((file) => ({ file, src: preview(file) }))]);
  }

  function unpick(key: string) {
    const gone = adding[Number(key)];
    if (gone?.src) URL.revokeObjectURL(gone.src);
    setAdding((a) => a.filter((_, i) => String(i) !== key));
  }

  // Opened from a notification about news: bring the newest entry into view once it has loaded, marked for a moment.
  const loaded = t !== null;
  useEffect(() => {
    if (!loaded || window.location.hash !== "#latest") return;
    document.getElementById("latest")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setPointed(false), 2500);
    return () => clearTimeout(timer);
  }, [loaded]);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim() && adding.length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      // Files first: a refused one stops here, leaving it and the reply on screen to try again.
      let left = adding;
      while (left.length > 0) {
        await api.upload<Attachment>(`/feedback/${ref}/attachments`, left[0].file);
        if (left[0].src) URL.revokeObjectURL(left[0].src);
        left = left.slice(1);
        setAdding(left);
      }
      setT(reply.trim() ? await api.post<Tracker>(`/feedback/${ref}/replies`, { body: reply }) : await api.get<Tracker>(`/feedback/${ref}/tracker`));
      setReply("");
      setWriting(false);
      toast.success("Sent");
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
  if (general) return <GeneralView item={general} onChange={setGeneral} />;
  if (!t) {
    return (
      <div className="mx-auto grid max-w-4xl gap-4 px-4 py-10" aria-busy="true">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  // A person's words are messages, named with what they are on the item; Sig's words on each move and the
  // other changes are small lines between them (D105).
  const entries: ThreadEntry[] = t.history.map((h, i) => {
    const newest = i === t.history.length - 1;
    const said = h.said_by
      ? {
          who: h.said_by === "You" ? me.name : h.said_by,
          role: h.said_by === "You" ? "You" : h.said_by === t.assignee?.name ? "has it" : h.said_by === t.approver?.name ? "approved it" : "Digital team",
          text: h.detail ?? "",
        }
      : { text: h.detail && h.detail !== h.text ? `${h.text}: ${h.detail}` : h.text };
    return { key: `${h.at}-${i}`, at: h.at, ...said, domId: newest ? "latest" : undefined, ring: newest && pointed };
  });
  const people = [
    { name: me.name, role: "You" },
    ...(t.assignee ? [{ name: t.assignee.name, role: "has it" }] : []),
    ...(t.approver ? [{ name: t.approver.name, role: "approved it" }] : []),
  ];
  const sentFiles = shownFiles(t.attachments.filter((a) => !a.from_team));
  const teamFiles = shownFiles(t.attachments.filter((a) => a.from_team));
  const toAdd: Shown[] = adding.map((a, i) => ({ key: String(i), name: a.file.name, size: a.file.size, src: a.src }));
  // Who reads what they write: whoever has it and the approver (D101).
  const readers = [
    t.assignee && `${t.assignee.name}, who has it`,
    t.approver && t.approver.name !== t.assignee?.name && `${t.approver.name}, who approved it`,
  ].filter((r): r is string => Boolean(r));
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
          <StageStepper stages={t.stages} />
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

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <IsItFixed tracker={t} onChange={setT} />

            {/* The conversation sits straight on the page, not in a card (D105). */}
            <section id="activity" className="grid gap-4" aria-labelledby="activity-heading">
              <h2 id="activity-heading" className="text-lg font-bold">
                Conversation
              </h2>
              <ThreadPeople people={people} />
              {!t.assignee && <p className="text-sm text-muted-foreground">The Digital team is checking who it belongs to.</p>}
              <ActivityThread entries={entries} empty="Nothing yet." />
              {t.can_reply && (
                <form onSubmit={sendReply} className="grid gap-2 rounded-2xl border bg-card p-3">
                  <label htmlFor="reply" className="text-sm text-muted-foreground">
                    {readers.length > 0 ? `Your messages go to ${readers.join(" and ")}.` : "Your messages go to the Digital team."}
                  </label>
                  <Textarea
                    id="reply"
                    rows={1}
                    value={reply}
                    maxLength={4000}
                    placeholder="Write a message or add details"
                    onFocus={() => setWriting(true)}
                    onChange={(e) => setReply(e.target.value)}
                    onPaste={(e) => {
                      const images = pastedImages(e);
                      if (images.length === 0) return;
                      e.preventDefault();
                      setWriting(true);
                      pick(images);
                    }}
                    className={cn("rounded-xl text-base", writing ? "min-h-24" : "min-h-11")}
                  />
                  {toAdd.length > 0 && (
                    <div className="grid gap-2">
                      <FileThumbs files={toAdd} onRemove={unpick} />
                      <ScreenshotNote files={toAdd} />
                    </div>
                  )}
                  {sendError && (
                    <p className="text-sm text-destructive" role="alert">
                      {sendError}
                    </p>
                  )}
                  {writing && (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" className="h-11 rounded-xl px-5" disabled={sending || (!reply.trim() && adding.length === 0)}>
                          {sending ? <Loader2 className="animate-spin" /> : <Send />} Send
                        </Button>
                        <input
                          ref={fileInput}
                          type="file"
                          accept={ACCEPT}
                          multiple
                          className="sr-only"
                          tabIndex={-1}
                          aria-hidden="true"
                          data-testid="reply-files"
                          onChange={(e) => {
                            pick(Array.from(e.target.files ?? []));
                            e.target.value = "";
                          }}
                        />
                        <Button type="button" variant="ghost" className="h-11 rounded-xl" disabled={sending} onClick={() => fileInput.current?.click()}>
                          <Paperclip /> Attach a file
                        </Button>
                        <PhotoButton className="h-11 rounded-xl" disabled={sending} onFiles={pick} />
                      </div>
                      <p className="text-xs text-muted-foreground">You can also paste a screenshot into the box.</p>
                    </>
                  )}
                </form>
              )}
            </section>
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 md:order-first">
            <section className="grid gap-2" aria-labelledby="what">
              <h2 id="what" className="text-sm font-semibold text-muted-foreground">
                What you sent
              </h2>
              <p className="font-semibold">{t.title}</p>
              {t.summary !== t.title && <p className="text-sm text-muted-foreground">{t.summary}</p>}
              <PriorityBadge priority={t.priority} quiet={isSettled(t.status)} className="flex w-fit" />
              <FileThumbs files={sentFiles} className="mt-2" />
            </section>

            {teamFiles.length > 0 && (
              <section className="grid gap-2" aria-labelledby="team-files">
                <h2 id="team-files" className="text-sm font-semibold text-muted-foreground">
                  From the team
                </h2>
                <FileThumbs files={teamFiles} />
              </section>
            )}

            <Button variant="ghost" className="h-auto min-h-11 justify-start rounded-xl px-0 text-left whitespace-normal" onClick={() => void toggleMute()}>
              {t.muted ? <BellOff /> : <Bell />}
              {t.muted ? "Unmute this item" : "Mute notifications for this item"}
            </Button>
            {muteError && (
              <p className="text-sm text-destructive" role="alert">
                {muteError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
