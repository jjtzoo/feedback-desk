"use client";

import { MoreHorizontal } from "lucide-react";

import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Card, Staff } from "@/lib/api";

const MOVES: { column: string; label: string; admin?: boolean; resolvedOnly?: boolean }[] = [
  { column: "approved", label: "Approved", admin: true },
  { column: "in_progress", label: "In progress" },
  { column: "resolved", label: "Resolved" },
  { column: "fixed", label: "Fixed", resolvedOnly: true },
];

/**
 * The list's row menu: open, post an update, assign, or move to another stage. Moves and updates
 * go through the same dialogs as the board and the panel, so a reason is still asked where one is needed.
 */
export function RowActions({
  card,
  staff,
  onOpen,
  onUpdate,
  onAssign,
  onMove,
}: {
  card: Card;
  staff: Staff[];
  onOpen: () => void;
  onUpdate: () => void;
  onAssign: (assigneeId: string | null) => void;
  onMove: (column: string) => void;
}) {
  const me = useMe();
  const open = !["declined", "closed", "acknowledged"].includes(card.status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-lg" aria-label={`Actions for ${card.reference}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
        {open && (
          <>
            <DropdownMenuItem onSelect={onUpdate}>Post update</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Assign to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => onAssign(null)} disabled={!card.assignee}>
                  Unassigned
                </DropdownMenuItem>
                {staff
                  .filter((s) => s.active)
                  .map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => onAssign(s.id)} disabled={card.assignee?.id === s.id}>
                      {s.name}
                      {s.is_away && " (away)"}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {MOVES.filter((m) => (!m.admin || me.role === "admin") && (!m.resolvedOnly || card.status === "resolved")).map((m) => (
                  <DropdownMenuItem key={m.column} onSelect={() => onMove(m.column)}>
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
