"use client";

import { ChevronDown } from "lucide-react";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Status } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import type { Move } from "@/lib/moves";

/**
 * One Status button (D91): it says where the item is and lists only the moves allowed from there. Each move
 * opens the dialog it already has. Red only when there is work to move on; closing alone stays outlined.
 */
export function StatusMenu({ status, moves, busy, onMove }: { status: Status; moves: Move[]; busy: boolean; onMove: (m: Move) => void }) {
  const next = moves.some((m) => m.key !== "close");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={next ? "default" : "outline"} className="h-10 rounded-xl" disabled={busy}>
          Status: <span>{STATUS_LABEL[status]}</span> <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move to</DropdownMenuLabel>
        {moves.map((m, i) => (
          <Fragment key={m.key}>
            {m.key === "close" && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onMove(m)}>{m.label}</DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
