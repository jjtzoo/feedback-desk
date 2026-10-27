import type { Card, Me, Staff } from "@/lib/api";
import { ownership } from "@/lib/ownership";

/** A stage move. `column` is where a board drag or the row menu puts the card; moves without one open a dialog only. */
export type MoveKey = "approve" | "start" | "restart" | "resolve" | "close" | "close_fixed";
export type MoveColumn = "approved" | "in_progress" | "resolved";
export interface Move {
  key: MoveKey;
  label: string;
  column?: MoveColumn;
}

const CLOSE: Move = { key: "close", label: "Close…" };

/**
 * The moves the signed-in person can make from an item's status (D91): the panel's Status menu, the board
 * drag and the row menu all read this list. The API checks every one (D3 approval, D53 holder only, D45 and
 * D92 close rules); the screen only offers what will be allowed. A resolved item is closed by the person who
 * raised it or by the clock, so only an Admin sees Close as fixed (D92).
 */
export function allowedMoves(card: Card, me: Me, staff: Staff[]): Move[] {
  const can = ownership(card, me, staff);
  const admin = me.role === "admin";
  const resolve: Move = { key: "resolve", label: "Resolve…", column: "resolved" };
  switch (card.status) {
    case "new":
      return [CLOSE];
    case "needs_review":
    case "awaiting_approval":
      return [...(admin ? [{ key: "approve", label: "Approve", column: "approved" } as Move] : []), CLOSE];
    case "approved":
      return [
        ...(can.holder || can.canAssignToMe ? [{ key: "start", label: "Start work", column: "in_progress" } as Move] : []),
        ...(can.holder ? [resolve] : []),
        CLOSE,
      ];
    case "in_progress":
      return [...(can.holder ? [resolve] : []), CLOSE];
    case "resolved":
      return [
        ...(can.holder ? [{ key: "restart", label: "Start work again", column: "in_progress" } as Move] : []),
        ...(admin ? [{ key: "close_fixed", label: "Close as fixed…" } as Move] : []),
      ];
    default:
      return [];
  }
}
