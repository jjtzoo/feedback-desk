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
import { ownership } from "@/lib/ownership";

const MOVES: { column: string; label: string; admin?: boolean; resolvedOnly?: boolean }[] = [
  { column: "approved", label: "Approved", admin: true },
  { column: "in_progress", label: "In progress" },
  { column: "resolved", label: "Resolved" },
  { column: "fixed", label: "Fixed", resolvedOnly: true },
];

/**
 * The list's row menu: open, post an update, take it on, hand it over, or move it to another stage.
 * Only the holder posts updates and moves it on (D53); taking over someone else's item happens in the
 * panel, where their latest step shows first. Moves and updates go through the same dialogs as the board
 * and the panel, so a reason is still asked where one is needed.
 */
export function RowActions({
  card,
  staff,
  onOpen,
  onUpdate,
  onAssignToMe,
  onHandOver,
  onMove,
}: {
  card: Card;
  staff: Staff[];
  onOpen: () => void;
  onUpdate: () => void;
  onAssignToMe: () => void;
  onHandOver: (assigneeId: string) => void;
  onMove: (column: string) => void;
}) {
  const me = useMe();
  const open = !["declined", "closed", "acknowledged"].includes(card.status);
  const can = ownership(card, me, staff);
  const moves = MOVES.filter((m) => (m.admin ? me.role === "admin" : can.holder) && (!m.resolvedOnly || card.status === "resolved"));
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
            {can.holder && <DropdownMenuItem onSelect={onUpdate}>Post update</DropdownMenuItem>}
            {can.canAssignToMe && <DropdownMenuItem onSelect={onAssignToMe}>Assign to me</DropdownMenuItem>}
            {can.canHandOver && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Hand over to</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {staff
                    .filter((s) => s.active)
                    .map((s) => (
                      <DropdownMenuItem key={s.id} onSelect={() => onHandOver(s.id)} disabled={card.assignee?.id === s.id}>
                        {s.name}
                        {s.is_away && " (away)"}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {moves.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {moves.map((m) => (
                      <DropdownMenuItem key={m.column} onSelect={() => onMove(m.column)}>
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
