import { Check } from "lucide-react";

import type { StageStep } from "@/lib/api";
import { day, when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The tracker's five stages, each marked done, current or not yet, with the day it was reached. */
export function StageStepper({ stages }: { stages: StageStep[] }) {
  return (
    <ol className="grid grid-cols-5 gap-1">
      {stages.map((s, i) => (
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
  );
}
