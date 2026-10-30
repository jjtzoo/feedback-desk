"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Ending, Status } from "@/lib/api";
import { ENDING_LABEL, STATUS_LABEL } from "@/lib/format";
import type { Move } from "@/lib/moves";

/**
 * One Status button (D91): it says where the item is and lists only the moves allowed from there. Each move
 * opens the dialog it already has. Red only when there is work to move on; going back or closing alone stays
 * outlined, and the moves back sit in their own group (D113). An ended item says how it ended, as its badge does.
 */
export function StatusMenu({
  status,
  ending = null,
  moves,
  busy,
  onMove,
}: {
  status: Status;
  ending?: Ending | null;
  moves: Move[];
  busy: boolean;
  onMove: (m: Move) => void;
}) {
  const forward = moves.filter((m) => !m.back && m.key !== "close");
  const back = moves.filter((m) => m.back);
  const close = moves.find((m) => m.key === "close");
  const item = (m: Move) => (
    <DropdownMenuItem key={m.key} onSelect={() => onMove(m)}>
      {m.label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={forward.length > 0 ? "default" : "outline"} className="h-10 rounded-xl" disabled={busy}>
          Status: <span>{ending ? ENDING_LABEL[ending] : STATUS_LABEL[status]}</span> <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {(forward.length > 0 || back.length === 0) && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move to</DropdownMenuLabel>
            {forward.map(item)}
          </DropdownMenuGroup>
        )}
        {back.length > 0 && (
          <>
            {forward.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move back</DropdownMenuLabel>
              {back.map(item)}
            </DropdownMenuGroup>
          </>
        )}
        {close && (
          <>
            {(forward.length > 0 || back.length > 0) && <DropdownMenuSeparator />}
            {item(close)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
