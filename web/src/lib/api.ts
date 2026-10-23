// Typed client for the Feedback API (backend/app/schemas). Screens call the API only (spec v3).

export type Role = "staff" | "digital" | "admin";
export type Status =
  | "new"
  | "needs_review"
  | "awaiting_approval"
  | "approved"
  | "in_progress"
  | "resolved"
  | "acknowledged"
  | "declined"
  | "closed";
export type Stage = "received" | "approved" | "in_progress" | "resolved" | "closed";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type WorkType = "fix" | "improvement" | "new_feature" | "no_change";
export type Category =
  | "bug"
  | "performance"
  | "data_issue"
  | "usability"
  | "feature_request"
  | "access_request"
  | "question"
  | "praise";
export type ConsoleView = "board" | "list" | "cards";

export interface Me {
  email: string;
  name: string;
  role: Role;
  is_triage_lead: boolean;
  dev_login: boolean;
}

export interface Project {
  slug: string;
  name: string;
  project_group: "platforms" | "agents" | "other";
}

export interface ProjectAdmin extends Project {
  id: string;
  description: string;
  keywords: string[];
  aliases: string[];
  owner_id: string | null;
  active: boolean;
}

export interface Person {
  id: string;
  name: string;
}

export interface Staff {
  id: string;
  google_email: string;
  name: string;
  role: "digital" | "admin";
  skills: string[];
  is_away: boolean;
  is_triage_lead: boolean;
  active: boolean;
  open_items: number;
}

export interface Rule {
  id: string;
  project_id: string | null;
  category: Category | null;
  assignee_id: string;
  priority_order: number;
  active: boolean;
}

export interface Attachment {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ChatCard {
  project: string;
  work_type: string;
  category: string;
  priority: string;
  title: string;
  summary: string;
}

export interface Chip {
  label: string;
  value: string;
}

export interface Duplicate {
  reference: string;
  title: string;
  date: string;
}

export type UsageLimit = "user" | "budget";

export interface ChatStart {
  mode: "chat" | "fallback";
  /** Set when a spend guard sent this chat to the backup form (D36). */
  limit: UsageLimit | null;
  session_id: string | null;
  greeting: string | null;
  project: Project | null;
  projects: Project[];
  max_file_mb: number;
  max_files: number;
}

export interface Saved {
  reference: string;
  assigned_to: string;
  status: Status;
}

export interface MyItem {
  reference: string;
  title: string;
  project: string | null;
  stage: Stage;
  status: Status;
  status_text: string;
  updated_at: string;
  created_at: string;
  following: boolean;
}

export interface TimelineEntry {
  at: string;
  text: string;
  detail: string | null;
}

export interface StageStep {
  key: Stage;
  label: string;
  state: "done" | "current" | "todo";
  at: string | null;
}

export interface Tracker {
  reference: string;
  title: string;
  summary: string;
  project: string | null;
  category: string;
  work_type: string;
  priority: Priority | null;
  status: Status;
  status_text: string;
  stage: Stage;
  stages: StageStep[];
  expected_by: string | null;
  assignee: { name: string; role: string; email: string } | null;
  latest_update: { body: string; author: string | null; at: string } | null;
  history: TimelineEntry[];
  close_reason: string | null;
  merged_into: string | null;
  attachments: Attachment[];
  can_reply: boolean;
  muted: boolean;
}

export interface Card {
  id: string;
  reference: string;
  title: string;
  summary: string;
  project: Project | null;
  work_type: WorkType | null;
  category: Category | null;
  priority: Priority | null;
  status: Status;
  stage: Stage;
  submitter_name: string;
  assignee: Person | null;
  created_at: string;
  expected_by: string | null;
  overdue: boolean;
  has_files: boolean;
  unread_reply: boolean;
  flagged: boolean;
  channel: "chat" | "fallback";
}

export interface Column {
  key: string;
  title: string;
  count: number;
  overdue: number;
  items: Card[];
}

export interface Board {
  columns: Column[];
  view: ConsoleView;
}

export interface ItemList {
  items: Card[];
  total: number;
  page: number;
  page_size: number;
  view: ConsoleView;
}

export interface Message {
  id: string;
  author_type: "staff" | "digital" | "agent" | "system";
  author_name: string | null;
  message_type: "chat" | "reply" | "note" | "progress" | "follow_up";
  body: string;
  is_internal: boolean;
  expected_by: string | null;
  created_at: string;
}

export interface FeedbackEvent {
  actor_type: string;
  actor_name: string | null;
  event_type: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  is_public: boolean;
  public_text: string | null;
  created_at: string;
}

export interface DevBrief {
  problem?: string;
  steps?: string[];
  expected?: string;
  actual?: string;
  who_needs_it?: string;
  asking_for?: string;
  done_when?: string[];
  submitter_quote?: string;
  open_gaps?: string[];
}

export interface Detail extends Card {
  submitter_email: string;
  target_type: string | null;
  area: string | null;
  impact: string | null;
  effort: string | null;
  sentiment: string | null;
  ai_recommendation: { decision?: string; reason?: string };
  ai_confidence: Partial<Record<"project" | "work_type" | "category" | "priority", number>>;
  dev_brief: DevBrief;
  context: Record<string, unknown>;
  close_reason: string | null;
  merged_into: string | null;
  approved_by: string | null;
  approved_at: string | null;
  messages: Message[];
  events: FeedbackEvent[];
  attachments: Attachment[];
  followers: string[];
  duplicates: { reference: string; title: string; status: string; similarity: number }[];
  linked: string[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export interface ChannelMessage {
  id: string;
  author_name: string;
  author_email: string;
  body: string;
  mentions: string[];
  feedback_refs: string[];
  pinned: boolean;
  created_at: string;
}

export interface Channel {
  project: Project;
  messages: ChannelMessage[];
  chips: Record<string, { title: string; status: Status }>;
}

export interface ReleaseItem {
  id: string;
  title: string;
  body: string;
  work_type: WorkType | null;
  source_type: "feedback" | "progress" | "channel" | "manual";
  source_id: string | null;
  visible_to_staff: boolean;
  yours?: boolean;
}

export interface Release {
  id: string;
  project: Project;
  week_ending: string;
  status: "draft" | "approved" | "published";
  published_at: string | null;
  can_publish: boolean;
  items: ReleaseItem[];
}

export interface Allowance {
  used_tokens: number;
  limit_tokens: number;
  percent: number;
  blocked: UsageLimit | null;
}

export interface UsageTotals {
  calls: number;
  tokens: number;
  cost_aud: number;
}

export interface UsageSummary {
  today: UsageTotals;
  month: UsageTotals;
  daily_budget_aud: number;
  monthly_budget_aud: number;
  daily_tokens_per_user: number;
  avg_cost_per_item_aud: number | null;
  history: (UsageTotals & { day: string })[];
  people: { email: string; name: string; tokens: number; cost_aud: number; limit_reached: boolean }[];
}

export interface Dashboard {
  open_by_project: { label: string; count: number }[];
  open_by_assignee: { label: string; count: number }[];
  open_by_category: { label: string; count: number }[];
  open_by_work_type: { label: string; count: number }[];
  weekly: { week: string; received: number; resolved: number }[];
  avg_first_response_hours: number | null;
  approvals_waiting: number;
  approvals_over_2_days: number;
  project_reassignment_rate: number | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach Feedback. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } }).error;
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
      // A full reload on purpose: the session ended, so no client state should survive.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>("POST", path, undefined, form);
  },
};

export function errorText(e: unknown, fallback = "Something went wrong. Please try again."): string {
  return e instanceof ApiError ? e.message : fallback;
}

// --- chat: server-sent events over POST -------------------------------------------------

export type ChatEvent =
  | { type: "message"; text: string }
  | { type: "chips"; kind: "project" | "impact"; options: Chip[] }
  | { type: "duplicates"; candidates: Duplicate[] }
  | { type: "draft"; card: ChatCard; hash: string }
  | { type: "done"; reference: string; assigned_to: string; status: Status }
  | { type: "fallback"; reason: string }
  | { type: "end" };

export async function streamChat(path: string, body: unknown, onEvent: (e: ChatEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
  } catch {
    onEvent({ type: "fallback", reason: "network" });
    return;
  }
  if (!res.ok || !res.body) {
    const data: unknown = await res.json().catch(() => ({}));
    const err = (data as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) onEvent({ type: name, ...JSON.parse(data) } as ChatEvent);
    }
  }
}

/** What needs attention: one number per inbox, plus the Admin's approvals (0 for everyone else). */
export interface Counts {
  mine: number;
  needs_review: number;
  open: number;
  overdue: number;
  closed: number;
  approvals: number;
}
