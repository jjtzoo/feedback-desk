import { MessageSquareText } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-[9px] bg-primary text-primary-foreground", className)} aria-hidden="true">
      <MessageSquareText className="size-[18px]" strokeWidth={2.25} />
    </span>
  );
}

export function Brand({ href = "/", tone = "light" }: { href?: string; tone?: "light" | "dark" }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-2.5 rounded-md text-lg font-extrabold tracking-tight">
      <BrandMark />
      <span className={tone === "dark" ? "text-band-foreground" : "text-foreground"}>Feedback</span>
    </Link>
  );
}

/** The 4 px red stripe across the top of every page (mockups D and E). */
export function Stripe() {
  return <div className="h-1 bg-primary" aria-hidden="true" />;
}
