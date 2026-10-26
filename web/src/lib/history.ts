import type { Category, FeedbackEvent, Priority, Project, Status, WorkType } from "@/lib/api";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, WORK_TYPE_LABEL, day } from "@/lib/format";

/** Why routing chose the person, in words for the console (D56). The router's reasons are in app/services/router.py. */
export function routingReason(reason: string, project: string | null): string {
  const words: Record<string, string> = {
    "project owner": project ? `owner of ${project}` : "tool owner",
    "routing rule": "routing rule",
    "project unclear": "tool unclear",
    "owner away": "owner is away",
    "rule assignee away": "the rule's person is away",
    "project has no owner": "tool has no owner",
    "flagged for the Admins": "flagged for the Admins",
    "praise is acknowledged": "praise",
  };
  return words[reason] ?? reason;
}

// What a move to each status means, said as the step it is (D57).
const STATUS_STEP: Record<Status, string> = {
  new: "Received",
  needs_review: "Sent to Needs review",
  awaiting_approval: "Sent for approval",
  approved: "Approved",
  in_progress: "Started work",
  resolved: "Resolved",
  acknowledged: "Acknowledged as thanks",
  declined: "Declined",
  closed: "Closed",
};

/** Who did it: a person by name; the system and the assistant by what they are, never "Feedback". */
export function actorName(e: FeedbackEvent): string {
  if (e.actor_type === "system") return "System";
  if (e.actor_type === "agent") return "Assistant";
  return e.actor_name ?? "Someone";
}

function name(o: Record<string, unknown>): string {
  return String(o.name ?? o.assignee ?? "nobody");
}

/** One History line in plain words: no status keys, field names or snake_case on screen (D57). */
export function historyLine(e: FeedbackEvent, projects: Project[]): string {
  const { before, after } = e;
  const projectName = (slug: unknown) => (slug === "general" || !slug ? "General" : (projects.find((p) => p.slug === slug)?.name ?? String(slug)));
  switch (e.event_type) {
    case "status":
      // Public moves already read plainly and carry their reason ("Declined: …", "Resolved: …"); the console
      // says Approved where staff read Planned (D43). Internal moves get the step's words.
      if (after.status === "approved") return "Approved";
      return e.public_text ?? STATUS_STEP[after.status as Status] ?? STATUS_LABEL[after.status as Status] ?? "Changed the stage";
    case "assigned":
      if (after.reason) return `Assigned to ${name(after)} by routing (${routingReason(String(after.reason), null)})`;
      if (e.actor_type !== "system" && e.actor_type !== "agent" && name(after) === e.actor_name) return `${e.actor_name} took this on`;
      return `${actorName(e)} assigned this to ${name(after)}`;
    case "taken_over":
      return `${actorName(e)} took this over from ${name(before)}` + (after.reason ? `: ${String(after.reason)}` : "");
    case "handed_over":
      return (name(before) === e.actor_name ? `${e.actor_name} handed this to ${name(after)}` : `${actorName(e)} assigned this to ${name(after)}`) + (after.reason ? `: ${String(after.reason)}` : "");
    case "correction": {
      if ("project" in after) return `Changed the tool from ${projectName(before.project)} to ${projectName(after.project)}`;
      if ("work_type" in after) return `Changed the work type from ${WORK_TYPE_LABEL[before.work_type as WorkType] ?? "none"} to ${WORK_TYPE_LABEL[after.work_type as WorkType]}`;
      if ("category" in after) return `Changed the category from ${CATEGORY_LABEL[before.category as Category] ?? "none"} to ${CATEGORY_LABEL[after.category as Category]}`;
      if ("priority" in after) return `Changed the priority from ${PRIORITY_LABEL[before.priority as Priority] ?? "none"} to ${PRIORITY_LABEL[after.priority as Priority]}`;
      return "Corrected a field";
    }
    case "expected_by":
      return after.expected_by ? `Set Expected by to ${day(String(after.expected_by))}` : "Cleared Expected by";
    case "opened":
      return `${actorName(e)} opened it`;
    case "asked_for_info":
      return after.ask === "owner" ? "Asked the owner a question" : "Asked the person who raised it for more information";
    case "impact":
      return `Impact raised to ${String(after.impact ?? "").replace(/_/g, " ")} after another report`;
    case "linked":
      return after.merged ? `${String(after.merged)} was merged into this` : "Linked another item";
    default:
      return e.public_text ?? "Updated it";
  }
}
