"use client";

import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { StageStepper } from "@/components/stage-stepper";
import { Button } from "@/components/ui/button";
import { api, errorText, type GeneralItem } from "@/lib/api";
import { day, when } from "@/lib/format";

/** Someone else's item as general information (D97): where it is and what has been done, without the
 *  people involved. From here a colleague can say it affects them too, which follows it. */
export function GeneralView({ item, onChange }: { item: GeneralItem; onChange: (item: GeneralItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function affectsMe() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.post<GeneralItem>(`/feedback/${item.reference}/plus-one`));
      toast.success("Added. The owner knows it affects you too, and you'll get its updates.");
    } catch (err) {
      setError(errorText(err, "We couldn't add that. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMute() {
    setError(null);
    try {
      await api.post(`/feedback/${item.reference}/mute`, { muted: !item.muted });
      onChange({ ...item, muted: !item.muted });
      toast.success(item.muted ? "Notifications are back on for this item." : "Muted. You won't get updates for this item.");
    } catch (err) {
      setError(errorText(err, "We couldn't change that. Please try again."));
    }
  }

  return (
    <div className="pb-12">
      <section className="bg-band text-band-foreground">
        <div className="mx-auto max-w-4xl px-4 pt-8 pb-20 sm:px-6">
          <p className="text-sm text-band-muted">
            <span className="font-mono font-semibold text-band-foreground">{item.reference}</span> · Someone else&apos;s feedback
          </p>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{item.status_text}</h1>
          {item.expected_by && <p className="mt-1 text-lg text-band-foreground">Expected by {day(item.expected_by)}</p>}
          <p className="mt-2 text-band-muted">{item.project ?? "Tool to confirm"}</p>
        </div>
      </section>

      <div className="mx-auto -mt-12 grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-6 px-4 sm:px-6">
        <section className="rounded-3xl border bg-card p-5 shadow-card sm:p-6" aria-label="Progress">
          <StageStepper stages={item.stages} />
          {item.merged_into && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted p-4 text-sm">
              <p>This was merged into another item, which has the updates.</p>
              <Button asChild variant="outline" className="h-11 rounded-xl">
                <Link href={`/track/${item.merged_into}`}>View original ticket</Link>
              </Button>
            </div>
          )}
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="about">
              <h2 id="about" className="text-sm font-semibold text-muted-foreground">
                What it&apos;s about
              </h2>
              <p className="mt-2 font-semibold">{item.title}</p>
              {item.summary !== item.title && <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>}
            </section>

            {item.can_plus_one && (
              <section className="grid gap-2">
                <Button className="h-11 w-fit rounded-xl px-5" disabled={busy} onClick={() => void affectsMe()}>
                  {busy && <Loader2 className="animate-spin" />} This affects me too
                </Button>
                <p className="text-sm text-muted-foreground">The owner is told, and you&apos;ll get its updates.</p>
              </section>
            )}
            {item.following && (
              <section className="grid gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Check className="size-4" aria-hidden="true" /> You&apos;re following this
                </p>
                <Button variant="ghost" className="h-auto min-h-11 justify-start rounded-xl text-left whitespace-normal" onClick={() => void toggleMute()}>
                  {item.muted ? <BellOff /> : <Bell />}
                  {item.muted ? "Unmute this item" : "Mute notifications for this item"}
                </Button>
              </section>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <section className="rounded-3xl border bg-card p-5 shadow-card" aria-labelledby="updates">
            <h2 id="updates" className="text-sm font-semibold text-muted-foreground">
              Progress updates
            </h2>
            {item.updates.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              <ol className="mt-3 grid gap-4">
                {item.updates.map((u, i) => (
                  <li key={`${u.at}-${i}`}>
                    <p className="whitespace-pre-wrap">{u.text}</p>
                    <time dateTime={u.at} className="font-mono text-xs text-muted-foreground tabular">
                      {when(u.at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
