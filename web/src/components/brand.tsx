import Link from "next/link";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-[9px] bg-primary text-primary-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="size-[26px]">
        <g fill="currentColor">
          <path d="M18 46Q12 54 6 58Q16 59 26 49Z" />
          <circle cx="21" cy="30" r="10" />
          <circle cx="33" cy="25" r="12" />
          <circle cx="44" cy="32" r="9" />
          <circle cx="16" cy="42" r="8" />
          <circle cx="47" cy="43" r="7" />
          <rect x="12" y="30" width="40" height="20" rx="10" />
          <circle cx="4.5" cy="27" r="3.2" />
          <circle cx="57.2" cy="25" r="3.2" />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round">
          <path d="M12 38Q5 36 4.5 29" />
          <path d="M50 37Q56 34 57 27" />
        </g>
        <circle cx="56" cy="14.5" r="4.2" fill="currentColor" fillOpacity={0.6} />
        <circle cx="60.5" cy="6" r="2.6" fill="currentColor" fillOpacity={0.4} />
        <rect x="25" y="30" width="4" height="9" rx="2" className="fill-band" />
        <rect x="36" y="30" width="4" height="9" rx="2" className="fill-band" />
        <rect x="27" y="42" width="11" height="3.2" rx="1.6" className="fill-primary" />
      </svg>
    </span>
  );
}

export function Brand({ href = "/", tone = "light" }: { href?: string; tone?: "light" | "dark" }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-2.5 rounded-md text-lg whitespace-nowrap font-extrabold tracking-tight">
      <BrandMark />
      <span className={tone === "dark" ? "text-band-foreground" : "text-foreground"}>Smoke Signal</span>
    </Link>
  );
}

/** The 4 px red stripe across the top of every page (mockups D and E). */
export function Stripe() {
  return <div className="h-1 bg-primary" aria-hidden="true" />;
}
