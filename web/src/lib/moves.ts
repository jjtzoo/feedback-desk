import type { Card, Me, Staff } from "@/lib/api";
import { ownership } from "@/lib/ownership";

/**
 * A stage move. `column` is where a board drag or the row menu puts the card; moves without one open a dialog only.
 * `back` marks a move that takes the item back a stage (D113): the Status menu groups those apart.
 */
export type MoveKey = "approve" | "start" | "restart" | "resolve" | "close" | "close_fixed" | "unapprove" | "stop" | "reopen";
export type MoveColumn = "awaiting_approval" | "approved" | "in_progress" | "resolved";
export interface Move {
  key: MoveKey;
  label: string;
  column?: MoveColumn;
  back?: boolean;
}

const CLOSE: Move = { key: "close", label: "Close…" };
const REOPEN: Move = { key: "reopen", label: "Reopen…", back: true };

/**
 * The moves the signed-in person can make from an item's status (D91): the panel's Status menu, the board
 * drag and the row menu all read this list. The API checks every one (D3 approval, D53 holder only, D45 and
 * D92 close rules); the screen only offers what will be allowed. A resolved item is closed by the person who
 * raised it or by the clock, so only an Admin sees Close as fixed (D92). Going back (D113): an Admin un-approves
 * before work starts, the holder stops work, and an Admin reopens an ended item, though not a merged duplicate
 * (a merge has no undo) or praise.
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
        ...(admin ? [{ key: "unapprove", label: "Un-approve…", column: "awaiting_approval", back: true } as Move] : []),
        CLOSE,
      ];
    case "in_progress":
      return [...(can.holder ? [resolve, { key: "stop", label: "Stop work…", column: "approved", back: true } as Move] : []), CLOSE];
    case "resolved":
      return [
        ...(can.holder ? [{ key: "restart", label: "Start work again", column: "in_progress" } as Move] : []),
        ...(admin ? [{ key: "close_fixed", label: "Close as fixed…" } as Move] : []),
      ];
    case "declined":
      return admin ? [REOPEN] : [];
    case "closed":
      return admin && card.ending !== "duplicate" ? [REOPEN] : [];
    default:
      return [];
  }
}
