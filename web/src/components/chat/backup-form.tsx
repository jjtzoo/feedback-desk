"use client";

import { CircleAlert, Loader2, Send, TriangleAlert } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Project, type Saved } from "@/lib/api";
import { cn } from "@/lib/utils";

const HOW_MUCH = [
  { value: "blocking", label: "Blocking my work" },
  { value: "annoying", label: "Annoying" },
  { value: "nice_to_have", label: "Nice-to-have" },
] as const;

/** When the assistant is down: a simple form so feedback is never lost (brief §8). */
export function BackupForm({
  projects,
  initialProject,
  initialDetails,
  sessionId,
  context,
  onSaved,
}: {
  projects: Project[];
  initialProject: string | null;
  initialDetails: string;
  sessionId: string | null;
  context: Record<string, string>;
  onSaved: (s: Saved) => void;
}) {
  const [project, setProject] = useState(initialProject ?? "");
  const [details, setDetails] = useState(initialDetails);
  const [howMuch, setHowMuch] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const detailsField = useRef<HTMLTextAreaElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!details.trim()) {
      setDetailsError(true);
      detailsField.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.post<Saved>("/feedback/fallback", {
          project_slug: project || null,
          details,
          how_much: howMuch || null,
          session_id: sessionId,
          context,
        }),
      );
    } catch (err) {
      setError(errorText(err, "We couldn't send that. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5 p-5 sm:p-6" noValidate>
      <Alert>
        <TriangleAlert className="text-warning" />
        <AlertDescription>
          <strong className="text-foreground">The assistant isn&apos;t available right now.</strong> Answer these and the Digital team still gets your
          feedback. What you typed is kept below.
        </AlertDescription>
      </Alert>
      <div className="grid gap-2">
        <Label htmlFor="fb-project">Which tool is it about?</Label>
        <Select value={project || "none"} onValueChange={(v) => setProject(v === "none" ? "" : v)}>
          <SelectTrigger id="fb-project" className="h-11 w-full rounded-xl">
            <SelectValue placeholder="Not sure" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not sure</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="fb-details">What happened, or what would you like? (required)</Label>
        <p className="text-sm text-muted-foreground">For a problem: what you did, what you expected, and what happened instead.</p>
        <Textarea
          id="fb-details"
          ref={detailsField}
          rows={6}
          maxLength={4000}
          value={details}
          onChange={(e) => {
            setDetails(e.target.value);
            setDetailsError(false);
          }}
          aria-invalid={detailsError || undefined}
          aria-describedby={detailsError ? "fb-details-error" : undefined}
          className="rounded-xl text-base"
        />
        {detailsError && (
          <p id="fb-details-error" className="flex items-center gap-1.5 text-sm text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> Tell us what happened or what you need.
          </p>
        )}
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">How much is it affecting your work?</legend>
        <div className="flex flex-wrap gap-2">
          {HOW_MUCH.map((h) => (
            <label
              key={h.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ring",
                howMuch === h.value && "border-primary bg-brand-tint text-brand-text",
              )}
            >
              <input type="radio" name="how-much" value={h.value} className="sr-only" checked={howMuch === h.value} onChange={() => setHowMuch(h.value)} />
              {h.label}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div>
        <Button type="submit" className="h-11 rounded-xl px-6 text-base" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Send feedback
        </Button>
      </div>
    </form>
  );
}
