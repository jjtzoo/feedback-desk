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
import type { Move } from "@/lib/moves";
import { ownership } from "@/lib/ownership";

/**
 * The list's row menu: open, post an update, take it on, hand it over, or change its status.
 * Only the holder posts updates (D53); taking over someone else's item happens in the panel, where their
 * latest step shows first. The status moves are the panel's Status menu list (D91) and go through the
 * same dialogs, so a reason is still asked where one is needed.
 */
export function RowActions({
  card,
  staff,
  onOpen,
  onChangeDue,
  onAssignToMe,
  onHandOver,
  moves,
  onMove,
}: {
  card: Card;
  staff: Staff[];
  onOpen: () => void;
  onChangeDue: () => void;
  onAssignToMe: () => void;
  onHandOver: (assigneeId: string) => void;
  moves: Move[];
  onMove: (move: Move) => void;
}) {
  const me = useMe();
  const open = !["declined", "closed", "acknowledged"].includes(card.status);
  const can = ownership(card, me, staff);
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
            {can.holder && <DropdownMenuItem onSelect={onChangeDue}>Change due date</DropdownMenuItem>}
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
                  <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {moves.map((m) => (
                      <DropdownMenuItem key={m.key} onSelect={() => onMove(m)}>
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
