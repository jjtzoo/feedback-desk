"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand, Stripe } from "@/components/brand";
import { GuideButton } from "@/components/guide";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/chat", label: "Give feedback" },
  { href: "/my", label: "My feedback" },
  { href: "/whats-new", label: "What's new" },
];

/** The tracker belongs to My feedback, so that item stays highlighted there. */
function isActive(href: string, path: string): boolean {
  if (href === "/my") return path.startsWith("/my") || path.startsWith("/track");
  return path.startsWith(href);
}

export function StaffHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 bg-card">
      <Stripe />
      <div className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Brand />
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((n) => {
              const active = isActive(n.href, path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-brand-tint text-brand-text hover:bg-brand-tint hover:text-brand-text",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <GuideButton area="staff" />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="grid grid-cols-3 gap-1 px-3 pb-2 md:hidden">
          {NAV.map((n) => {
            const active = isActive(n.href, path);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid min-h-11 place-items-center rounded-full px-2 text-center text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
                  active && "bg-brand-tint text-brand-text",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function StaffFooter() {
  return (
    <footer className="mt-auto border-t bg-card">
      <p className="mx-auto max-w-6xl px-4 py-5 text-sm text-muted-foreground sm:px-6">
        Feedback goes to the REDADAIR Digital team. Chats are processed by Google&apos;s Gemini model. Passwords, card numbers and tax file
        numbers are removed before anything is saved.
      </p>
    </footer>
  );
}
