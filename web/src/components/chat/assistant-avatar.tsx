import { Sparkles } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** The Feedback assistant's face. Add an `AvatarImage` here when the artwork is supplied. */
export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <Avatar className={cn("size-8", className)} aria-hidden="true">
      <AvatarFallback className="bg-muted text-muted-foreground">
        <Sparkles className="size-[55%]" />
      </AvatarFallback>
    </Avatar>
  );
}
