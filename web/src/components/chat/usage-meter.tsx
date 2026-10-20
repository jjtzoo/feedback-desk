import { TriangleAlert } from "lucide-react";

import type { Allowance } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The person's share of today's assistant allowance (D36). Quiet until half is used, and hidden
 *  when there is no per-person limit. */
export function UsageMeter({ allowance }: { allowance: Allowance }) {
  if (!allowance.limit_tokens || allowance.percent < 50) return null;
  const high = allowance.percent >= 80;
  return (
    <div className="mt-2 grid gap-1 px-1">
      <p className={cn("flex items-center gap-1.5 text-xs", high ? "font-semibold text-warning" : "text-muted-foreground")}>
        {high && <TriangleAlert className="size-3.5" aria-hidden="true" />}
        Today&apos;s assistant allowance: {allowance.percent}% used
        {high && allowance.percent < 100 && ". The form still works if it runs out."}
      </p>
      <div
        role="meter"
        aria-label="Today's assistant allowance used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={allowance.percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width]", high ? "bg-warning" : "bg-muted-foreground")} style={{ width: `${allowance.percent}%` }} />
      </div>
    </div>
  );
}
