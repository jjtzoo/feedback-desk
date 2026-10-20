"use client";

import { BarChart3, Gavel, Hash, KanbanSquare, Menu, Megaphone, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Brand, Stripe } from "@/components/brand";
import { GuideButton } from "@/components/guide";
import { useMe } from "@/components/me";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/console", label: "Work", icon: KanbanSquare, exact: true },
  { href: "/console/approvals", label: "Approvals", icon: Gavel, admin: true },
  { href: "/console/channels", label: "Channels", icon: Hash },
  { href: "/console/releases", label: "Releases", icon: Megaphone },
  { href: "/console/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/console/admin", label: "Admin", icon: Settings2 },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const path = usePathname();
  return (
    <nav aria-label="Console" className="grid gap-1">
      {NAV.filter((n) => !n.admin || me.role === "admin").map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-brand-tint text-brand-text hover:bg-brand-tint hover:text-brand-text",
            )}
          >
            <Icon className="size-[18px]" aria-hidden="true" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [open, setOpen] = useState(false);

  if (me.role === "staff") {
    return (
      <div className="grid min-h-dvh place-content-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-extrabold">The console is for the Digital team</h1>
        <p className="text-muted-foreground">You can give feedback and follow it from the staff pages.</p>
        <Button asChild className="mx-auto h-11 rounded-xl">
          <Link href="/chat">Give feedback</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-band text-band-foreground">
        <Stripe />
        <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="size-11 text-band-foreground hover:bg-white/10 hover:text-band-foreground lg:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <SheetTitle className="mb-4">Console</SheetTitle>
              <NavLinks onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <Brand href="/console" tone="dark" />
          <span className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold sm:inline">Console</span>
          <div className="ml-auto flex items-center gap-1">
            <GuideButton area="console" tone="dark" />
            <NotificationBell tone="dark" />
            <UserMenu tone="dark" />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="sticky top-[60px] hidden h-[calc(100dvh-60px)] w-56 shrink-0 border-r bg-card p-3 lg:block">
          <NavLinks />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
