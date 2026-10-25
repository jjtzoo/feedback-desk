import { Bug, HelpCircle, KeyRound, Lightbulb } from "lucide-react";

/** The four ways into a chat. `id` is the `?start=` value on /chat; `text` pre-fills the message box. */
export const STARTERS = [
  { id: "broken", icon: Bug, label: "Something's broken", blurb: "An error, or something that isn't working.", text: "Something's broken: " },
  { id: "access", icon: KeyRound, label: "I need access", blurb: "Access to a platform or agent.", text: "I need access to " },
  { id: "idea", icon: Lightbulb, label: "I have an idea", blurb: "A way to make a tool better, or something new.", text: "It would help if " },
  { id: "how", icon: HelpCircle, label: "How do I…?", blurb: "Ask the team how something works.", text: "How do I " },
] as const;
