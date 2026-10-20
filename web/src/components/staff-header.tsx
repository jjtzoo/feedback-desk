"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand, Stripe } from "@/components/brand";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Give feedback" },
  { href: "/my", label: "My feedback" },
  { href: "/whats-new", label: "What's new" },
];

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
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
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
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground",
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
