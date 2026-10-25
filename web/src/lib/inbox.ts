import type { Role } from "@/lib/api";

/** Admins are mostly directors reading what is open; the Digital team starts with what is theirs. */
export function defaultInbox(role: Role): string {
  return role === "admin" ? "open" : "mine";
}
