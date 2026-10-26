import type { Category, Ending, Priority, Stage, Status, WorkType } from "./api";

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  fix: "Fix",
  improvement: "Improvement",
  new_feature: "New feature",
  no_change: "No change",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  bug: "Bug",
  performance: "Performance",
  data_issue: "Data issue",
  usability: "Usability",
  feature_request: "Feature request",
  access_request: "Access request",
  question: "Question",
  praise: "Praise",
};

export const PRIORITY_WORD: Record<Priority, string> = {
  P1: "Blocking",
  P2: "Major",
  P3: "Minor",
  P4: "Nice-to-have",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: `P1 · ${PRIORITY_WORD.P1}`,
  P2: `P2 · ${PRIORITY_WORD.P2}`,
  P3: `P3 · ${PRIORITY_WORD.P3}`,
  P4: `P4 · ${PRIORITY_WORD.P4}`,
};

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  needs_review: "Needs review",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  in_progress: "In progress",
  resolved: "Resolved",
  acknowledged: "Acknowledged",
  declined: "Declined",
  closed: "Closed",
};

/** How an item ended, in the words staff and the console both use (D44). */
export const ENDING_LABEL: Record<Ending, string> = {
  fixed: "Fixed",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
  declined: "Declined",
  no_longer_needed: "No longer needed",
};

/** Staff stages (D43): the console keeps "Approved", staff see "Planned". */
export const STAGE_LABEL: Record<Stage, string> = {
  received: "Received",
  approved: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const WORK_TYPES = Object.keys(WORK_TYPE_LABEL) as WorkType[];
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

/** Relative age for lists and cards: "now", "12 m", "3 h", "2 d". */
export function age(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "5 m ago", or "just now" in the first minute (never "now ago"). */
export function ago(iso: string, now: number = Date.now()): string {
  const text = age(iso, now);
  return text === "now" ? "just now" : `${text} ago`;
}

/** Exact time in the user's locale: "Tue 21 Oct, 2:30 pm". */
export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A date without time: "Thu 23 Oct". Accepts "2026-10-23" or a full timestamp. */
export function day(value: string): string {
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
