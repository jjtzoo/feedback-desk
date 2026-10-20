"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ActionKind = "update" | "resolve" | "close" | "decline" | "ask" | "merge";

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
  close: {
    title: "Close",
    description: "Closing ends the item for everyone following it.",
    field: "Reason (shown to staff)",
    button: "Close",
    required: false,
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
  wontFix?: boolean;
  ask?: "submitter" | "owner";
}

/** One dialog for every action that needs words (update, resolve, close, decline, ask, merge). */
export function ActionDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: ActionKind | null;
  onClose: () => void;
  onSubmit: (kind: ActionKind, result: ActionResult) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [expectedBy, setExpectedBy] = useState("");
  const [wontFix, setWontFix] = useState(false);
  const [ask, setAsk] = useState<"submitter" | "owner">("submitter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!kind) return null;
  const copy = COPY[kind];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    if ((copy.required || (kind === "close" && wontFix)) && !text.trim()) {
      setError(`${copy.field} is needed.`);
      return;
    }
    if (kind === "update" && !text.trim() && !expectedBy) {
      setError("Write an update or set an Expected by date.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(kind, { text: text.trim(), expectedBy: expectedBy || undefined, wontFix, ask });
    setBusy(false);
    if (ok) {
      setText("");
      setExpectedBy("");
      setWontFix(false);
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
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox checked={wontFix} onCheckedChange={(v) => setWontFix(v === true)} /> Won&apos;t fix (the reason is required)
      </Label>
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          {extra}
          <div className="grid gap-2">
            <Label htmlFor="action-text">{copy.field}</Label>
            {kind === "merge" ? (
              <Input id="action-text" placeholder="FB-0138" value={text} onChange={(e) => setText(e.target.value.toUpperCase())} className="h-11 rounded-xl font-mono" />
            ) : (
              <Textarea id="action-text" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} className="rounded-xl" />
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={kind === "decline" || (kind === "close" && wontFix) ? "destructive" : "default"} className="h-11 rounded-xl" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {copy.button}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
