"use client";

import { AppWindow, Bot, CircleHelp, Globe, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/api";

/** The catalogue's groups, in the order staff see them. */
export const PROJECT_GROUPS: { key: Project["project_group"]; label: string; icon: LucideIcon }[] = [
  { key: "platforms", label: "Platforms", icon: AppWindow },
  { key: "agents", label: "Agents", icon: Bot },
  { key: "other", label: "Other", icon: Globe },
];

const ICON = Object.fromEntries(PROJECT_GROUPS.map((g) => [g.key, g.icon])) as Record<Project["project_group"], LucideIcon>;

/**
 * The app cards a new chat opens with (D99): the person's usual tools first (D60), then the rest of
 * the catalogue by group, then Something else. A shortcut, not a step: the message box stays open.
 */
export function AppCards({
  projects,
  usual,
  disabled,
  onPick,
  onElse,
}: {
  projects: Project[];
  usual: string[];
  disabled: boolean;
  onPick: (project: Project) => void;
  onElse: () => void;
}) {
  const first = usual.map((slug) => projects.find((p) => p.slug === slug)).filter((p): p is Project => !!p);
  const groups = [
    { key: "usual", label: "Your usual tools", list: first },
    ...PROJECT_GROUPS.map((g) => ({ key: g.key, label: g.label, list: projects.filter((p) => p.project_group === g.key && !usual.includes(p.slug)) })),
  ].filter((g) => g.list.length > 0);

  return (
    <section aria-labelledby="app-cards-title" className="grid gap-3">
      <p id="app-cards-title" className="text-sm text-muted-foreground">
        Which tool is it about? Pick one, or just type below.
      </p>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label} className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground" aria-hidden="true">
            {g.label}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.list.map((p) => (
              <Card key={p.slug} icon={ICON[p.project_group]} label={p.name} disabled={disabled} onClick={() => onPick(p)} />
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card icon={CircleHelp} label="Something else" disabled={disabled} onClick={onElse} />
      </div>
    </section>
  );
}

function Card({ icon: Icon, label, disabled, onClick }: { icon: LucideIcon; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-12 justify-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm whitespace-normal"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      {label}
    </Button>
  );
}
