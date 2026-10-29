"use client";

import { Inbox, LayoutDashboard, Megaphone, MessageSquarePlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Brand, Stripe } from "@/components/brand";
import { GuideButton } from "@/components/guide";
import { useMe } from "@/components/me";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; tour: string; icon: LucideIcon };

/** The one thing to do: a red button beside the menus from 1024 px, the first link of the row below that (D109). */
const GIVE: NavItem = { href: "/chat", label: "Give feedback", tour: "nav-chat", icon: MessageSquarePlus };
/** The two places to look. */
const PLACES: NavItem[] = [
  { href: "/my", label: "My feedback", tour: "nav-my", icon: Inbox },
  { href: "/whats-new", label: "Fixes and updates", tour: "nav-whats-new", icon: Megaphone },
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
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 xl:flex">
            {PLACES.map((n) => {
              const active = isActive(n.href, path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-tour={n.tour}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                >
                  <n.icon className="size-4" aria-hidden="true" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Button asChild className="mr-2 hidden h-11 gap-2 rounded-full px-4 lg:inline-flex">
              <Link href={GIVE.href} data-tour={GIVE.tour} aria-current={isActive(GIVE.href, path) ? "page" : undefined}>
                <GIVE.icon className="size-4" aria-hidden="true" />
                {GIVE.label}
              </Link>
            </Button>
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
        {/* Below 1280 px the links take their own row, so they never squeeze between the logo and the menus;
            below 1024 px Give feedback joins them, as the first link. */}
        <nav aria-label="Main" className="mx-auto grid max-w-6xl grid-cols-3 gap-1 px-3 pb-2 md:flex md:px-6 lg:grid-cols-2 xl:hidden">
          {[GIVE, ...PLACES].map((n) => {
            const active = isActive(n.href, path);
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={n.tour}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-center text-[13px] font-semibold whitespace-nowrap text-muted-foreground md:flex-row md:gap-2 md:px-3.5 md:text-sm",
                  n === GIVE && "text-primary lg:hidden",
                  active && "bg-muted text-foreground",
                )}
              >
                <n.icon className="size-4" aria-hidden="true" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
