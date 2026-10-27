"use client";

import { Check, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Tracker } from "@/lib/api";
import { day } from "@/lib/format";

/**
 * Is it fixed? on the tracker of a resolved item, for the person who raised it (D92). Yes, close it ends it
 * as Fixed; I still have an issue asks what is still wrong (a screenshot optional) and sends it back to the
 * owner. Once closed, I still have an issue stays until reopen_until. The email's two links open the page
 * with ?fixed=yes or ?fixed=no: the answer is ready, one click away, so a mail scanner changes nothing.
 */
export function IsItFixed({ tracker, onChange }: { tracker: Tracker; onChange: (t: Tracker) => void }) {
  const question = tracker.is_it_fixed;
  const ref = tracker.reference;
  // It renders only once the tracker has loaded, so reading the address here can't upset hydration.
  const [issue, setIssue] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fixed") === "no");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"yes" | "issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Opened from the email: bring the question into view with that answer ready.
  useEffect(() => {
    const answer = new URLSearchParams(window.location.search).get("fixed");
    if (!answer && window.location.hash !== "#is-it-fixed") return;
    document.getElementById("is-it-fixed")?.scrollIntoView({ block: "center" });
    if (answer !== "no") yes.current?.focus();
  }, []);
  useEffect(() => {
    if (issue) box.current?.focus();
  }, [issue]);

  if (!question) return null;
  const resolved = question.state === "resolved";

  async function close() {
    setBusy("yes");
    setError(null);
    try {
      onChange(await api.post<Tracker>(`/feedback/${ref}/fixed`));
      toast.success("Closed as fixed. Thanks for letting us know.");
    } catch (e) {
      setError(errorText(e, "We couldn't close it. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  async function reopen(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Say what is still wrong.");
      box.current?.focus();
      return;
    }
    setBusy("issue");
    setError(null);
    try {
      let updated = await api.post<Tracker>(`/feedback/${ref}/still-an-issue`, { body: text });
      if (file) {
        try {
          await api.upload(`/feedback/${ref}/attachments`, file);
          updated = await api.get<Tracker>(`/feedback/${ref}/tracker`);
        } catch (err) {
          toast.error(`It's back with the owner, but the screenshot didn't upload: ${errorText(err)}`);
        }
      }
      onChange(updated);
      toast.success("Thanks. It's back with the owner.");
    } catch (err) {
      setError(errorText(err, "We couldn't send that. Your words are still here, so you can try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="is-it-fixed" className="rounded-3xl border-2 border-foreground bg-card p-5 shadow-card" aria-labelledby="is-it-fixed-heading">
      <h2 id="is-it-fixed-heading" className="font-semibold">
        {resolved ? "Is it fixed?" : "Still not right?"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {resolved
          ? `Try it, then tell us. If we don't hear from you, it closes as fixed on ${day(question.closes_at ?? "")}.`
          : `You can send it back to the team until ${day(question.reopen_until ?? "")}.`}
      </p>
      {!issue ? (
        <>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {resolved && (
              <Button ref={yes} className="h-11 rounded-xl px-5" disabled={busy !== null} onClick={() => void close()}>
                {busy === "yes" ? <Loader2 className="animate-spin" /> : <Check />} Yes, close it
              </Button>
            )}
            <Button variant="outline" className="h-11 rounded-xl px-5" disabled={busy !== null} onClick={() => setIssue(true)}>
              I still have an issue
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={reopen} className="mt-3 grid gap-2">
          <Label htmlFor="still-wrong">What&apos;s still wrong?</Label>
          <Textarea ref={box} id="still-wrong" rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} className="rounded-xl text-base" aria-invalid={error ? true : undefined} />
          <input ref={fileInput} id="still-wrong-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <p className="flex items-center gap-2 text-sm">
              <Paperclip className="size-4" aria-hidden="true" /> {file.name}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-lg"
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </p>
          ) : (
            <Button type="button" variant="ghost" className="h-11 justify-self-start rounded-xl" onClick={() => fileInput.current?.click()}>
              <Paperclip aria-hidden="true" /> Add a screenshot (optional)
            </Button>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 rounded-xl px-5" disabled={busy !== null}>
              {busy === "issue" && <Loader2 className="animate-spin" />} Send it back
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl px-5"
              disabled={busy !== null}
              onClick={() => {
                setIssue(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
