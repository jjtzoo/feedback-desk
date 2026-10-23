"use client";

import { ListFilter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface FilterField {
  param: string;
  label: string;
  options: [value: string, label: string][];
}

/** One Filter button that adds a chip per filter, instead of a row of always-open selects. */
export function FilterMenu({ fields, values, onChange }: { fields: FilterField[]; values: Record<string, string | null>; onChange: (patch: Record<string, string | null>) => void }) {
  const active = fields.filter((f) => values[f.param]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 gap-1.5 rounded-xl">
            <ListFilter aria-hidden="true" /> Filter
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {fields.map((f) => (
            <DropdownMenuSub key={f.param}>
              <DropdownMenuSubTrigger>{f.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={values[f.param] ?? ""} onValueChange={(v) => onChange({ [f.param]: v })}>
                  {f.options.map(([value, label]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active.map((f) => (
        <span key={f.param} className="inline-flex h-8 items-center gap-1 rounded-full bg-secondary pr-1 pl-3 text-sm font-medium">
          <span>
            {f.label}: {f.options.find(([v]) => v === values[f.param])?.[1] ?? values[f.param]}
          </span>
          <Button variant="ghost" size="icon-sm" className="size-6 rounded-full" aria-label={`Remove ${f.label} filter`} onClick={() => onChange({ [f.param]: null })}>
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      {active.length > 1 && (
        <Button variant="link" className="h-8 px-1" onClick={() => onChange(Object.fromEntries(active.map((f) => [f.param, null])))}>
          Clear all
        </Button>
      )}
    </div>
  );
}
