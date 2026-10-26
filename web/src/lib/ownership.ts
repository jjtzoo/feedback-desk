import type { Card, Me, Staff } from "@/lib/api";

/**
 * What the signed-in person may do with an item's hands (D53). The API checks every one of these;
 * the screen only offers what will be allowed.
 */
export function ownership(card: Card, me: Me, staff: Staff[]) {
  const myId = staff.find((s) => s.google_email === me.email)?.id ?? null;
  const holder = card.assignee !== null && card.assignee.id === myId;
  return {
    /** Start work, post updates, resolve: the holder only. */
    holder,
    /** Nobody has it: anyone in the Digital team can take it on. */
    canAssignToMe: card.assignee === null,
    /** Someone else has it: anyone else in the Digital team can take it over. */
    canTakeOver: card.assignee !== null && !holder,
    /** Give it to a named person: its holder, an Admin or the triage lead. */
    canHandOver: holder || me.role === "admin" || me.is_triage_lead,
  };
}
