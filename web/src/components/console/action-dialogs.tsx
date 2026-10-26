"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ActionKind = "update" | "resolve" | "fix" | "close" | "decline" | "ask" | "merge";

/** How an open item can end by hand (D45). Fixed comes from a resolved item; duplicate and declined have their own actions. */
export type CloseEnding = "wont_fix" | "no_longer_needed";

const CLOSE_ENDINGS: [CloseEnding, string, string][] = [
  ["wont_fix", "Won't fix", "We looked at it and the answer is no."],
  ["no_longer_needed", "No longer needed", "It stopped mattering, or it's covered by something else."],
];

const COPY: Record<ActionKind, { title: string; description: string; field: string; button: string; required: boolean }> = {
  update: {
    title: "Post a progress update",
    description: "Staff see it on their tracker and get it in the app and by email.",
    field: "Update",
    button: "Post update",
    required: false,
  },
  resolve: {
    title: "Resolve",
    description: "It becomes the last entry on the staff tracker.",
    field: "What was done",
    button: "Resolve",
    required: true,
  },
  fix: {
    title: "Close as fixed",
    description: "The work is done. The item ends as Fixed for everyone following it.",
    field: "",
    button: "Close as fixed",
    required: false,
  },
  close: {
    title: "Close",
    description: "Choose how it ends. Staff see the ending and the reason on their tracker.",
    field: "Reason (shown to staff)",
    button: "Close",
    required: true,
  },
  decline: {
    title: "Decline",
    description: "It won't be implemented. The reason is shown to the person who raised it.",
    field: "Reason",
    button: "Decline",
    required: true,
  },
  ask: {
    title: "Ask for more information",
    description: "The item keeps waiting for a decision.",
    field: "Question",
    button: "Send question",
    required: true,
  },
  merge: {
    title: "Merge into another item",
    description: "This item closes; everyone following it follows the original instead.",
    field: "Original reference",
    button: "Merge",
    required: true,
  },
};

export interface ActionResult {
  text: string;
  expectedBy?: string;
  ending?: CloseEnding;
  ask?: "submitter" | "owner";
}

/** One dialog for every action that needs words (update, resolve, close, decline, ask, merge). */
export function ActionDialog({
  kind,
  initialText = "",
  onClose,
  onSubmit,
}: {
  kind: ActionKind | null;
  /** Pre-fills the text, such as the original's reference when merging a suggested duplicate. */
  initialText?: string;
  onClose: () => void;
  onSubmit: (kind: ActionKind, result: ActionResult) => Promise<boolean>;
}) {
  const [text, setText] = useState(initialText);
  const [expectedBy, setExpectedBy] = useState("");
  const [ending, setEnding] = useState<CloseEnding | null>(null);
  const [ask, setAsk] = useState<"submitter" | "owner">("submitter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The dialog opens from a controlled prop, so Radix has no trigger to give focus back to.
  const opener = useRef<HTMLElement | null>(null);

  if (!kind) return null;
  const copy = COPY[kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    if (kind === "close" && !ending) {
      setError("Choose how it ends.");
      return;
    }
    if (copy.required && !text.trim()) {
      setError(`${copy.field} is needed.`);
      return;
    }
    if (kind === "update" && !text.trim() && !expectedBy) {
      setError("Write an update or set an Expected by date.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(kind, { text: text.trim(), expectedBy: expectedBy || undefined, ending: ending ?? undefined, ask });
    setBusy(false);
    if (ok) {
      setText("");
      setExpectedBy("");
      setEnding(null);
      setError(null);
      onClose();
    }
  }

  let extra: ReactNode = null;
  if (kind === "update") {
    extra = (
      <div className="grid gap-2">
        <Label htmlFor="expected-by">Expected by (optional)</Label>
        <Input id="expected-by" type="date" value={expectedBy} onChange={(e) => setExpectedBy(e.target.value)} className="h-11 rounded-xl" />
      </div>
    );
  } else if (kind === "close") {
    extra = (
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-2 font-medium">Ends as</legend>
        {CLOSE_ENDINGS.map(([value, label, hint]) => (
          <Label key={value} className="flex items-start gap-2 font-normal">
            <input type="radio" name="close-ending" checked={ending === value} onChange={() => setEnding(value)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-muted-foreground">{hint}</span>
            </span>
          </Label>
        ))}
      </fieldset>
    );
  } else if (kind === "ask") {
    extra = (
      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-2 font-medium">Ask</legend>
        {(["submitter", "owner"] as const).map((who) => (
          <Label key={who} className="flex items-center gap-2 font-normal">
            <input type="radio" name="ask-who" checked={ask === who} onChange={() => setAsk(who)} className="size-4 accent-[var(--primary)]" />
            {who === "submitter" ? "The person who raised it" : "The owner (internal)"}
          </Label>
        ))}
      </fieldset>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          if (opener.current?.isConnected) {
            e.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          {extra}
          {kind === "fix" ? null : (
            <div className="grid gap-2">
              <Label htmlFor="action-text">{copy.field}</Label>
              {kind === "merge" ? (
                <Input id="action-text" placeholder="FB-0138" value={text} onChange={(e) => setText(e.target.value.toUpperCase())} className="h-11 rounded-xl font-mono" />
              ) : (
                <Textarea id="action-text" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} className="rounded-xl" />
              )}
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={kind === "decline" || (kind === "close" && ending === "wont_fix") ? "destructive" : "default"} className="h-11 rounded-xl" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {copy.button}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
