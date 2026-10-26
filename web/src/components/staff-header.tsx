"use client";

import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand, Stripe } from "@/components/brand";
import { GuideButton } from "@/components/guide";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/chat", label: "Give feedback", tour: "nav-chat" },
  { href: "/my", label: "My feedback", tour: "nav-my" },
  { href: "/whats-new", label: "Fixes and updates", tour: "nav-whats-new" },
];

/** The tracker belongs to My feedback, so that item stays highlighted there. */
function isActive(href: string, path: string): boolean {
  if (href === "/my") return path.startsWith("/my") || path.startsWith("/track");
  return path.startsWith(href);
}

export function StaffHeader() {
  const me = useMe();
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
                  data-tour={n.tour}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {me.role !== "staff" && (
              <Button asChild variant="ghost" className="h-11 gap-1.5 rounded-full px-3">
                <Link href="/console" data-tour="nav-console">
                  <LayoutDashboard className="size-5" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Console</span>
                </Link>
              </Button>
            )}
            <GuideButton area="staff" />
            <div data-tour="bell">
              <NotificationBell />
            </div>
            <div data-tour="user-menu">
              <UserMenu />
            </div>
          </div>
        </div>
        <nav aria-label="Main" className="grid grid-cols-3 gap-1 px-3 pb-2 md:hidden">
          {NAV.map((n) => {
            const active = isActive(n.href, path);
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={n.tour}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid min-h-11 place-items-center rounded-full px-2 text-center text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
                  active && "bg-muted text-foreground",
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
