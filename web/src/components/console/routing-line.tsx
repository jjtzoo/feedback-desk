import { Route } from "lucide-react";

import type { Card, Detail } from "@/lib/api";
import { routingReason } from "@/lib/history";
import { cn } from "@/lib/utils";

/** Who has the item and, while routing's choice still stands, that routing chose them and why (D56). */
export function RoutingLine({ item, className }: { item: Detail; className?: string }) {
  const confidence = item.ai_confidence.project;
  return (
    <div className={cn("grid gap-0.5 text-sm", className)}>
      <p>
        {item.routed && item.assignee ? (
          <>
            Auto-assigned to <span className="font-semibold">{item.assignee.name}</span> · {routingReason(item.routed, item.project?.name ?? null)}
          </>
        ) : item.assignee ? (
          <>
            With <span className="font-semibold">{item.assignee.name}</span>
          </>
        ) : (
          <>Nobody has it yet{item.routed && ` · ${routingReason(item.routed, item.project?.name ?? null)}`}</>
        )}
      </p>
      {item.routed === "project unclear" && item.project && (
        <p className="text-muted-foreground">
          Detected: {item.project.name}
          {confidence !== undefined && ` · ${Math.round(confidence * 100)}% sure`}
        </p>
      )}
    </div>
  );
}

/** The small marker on cards and rows until someone accepts or changes routing's choice (D56). */
export function AutoMarker({ card }: { card: Card }) {
  if (!card.routed || !card.assignee) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Assigned by routing; nobody has accepted or changed it yet">
      <Route className="size-3.5" aria-hidden="true" /> Auto
    </span>
  );
}
