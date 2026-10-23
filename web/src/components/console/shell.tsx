"use client";

import { ChartColumn, ClipboardCheck, House, LayoutList, Megaphone, Menu, Rocket, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";

import { Brand, Stripe } from "@/components/brand";
import { CountsProvider, useCounts } from "@/components/console/counts";
import { GuideButton } from "@/components/guide";
import { useMe } from "@/components/me";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean; admin?: boolean }[] = [
  { href: "/console", label: "Work", icon: LayoutList, exact: true },
  { href: "/console/approvals", label: "Approvals", icon: ClipboardCheck, admin: true },
  { href: "/console/channels", label: "Channels", icon: Megaphone },
  { href: "/console/releases", label: "Releases", icon: Rocket },
  { href: "/console/dashboard", label: "Dashboard", icon: ChartColumn },
  { href: "/console/admin", label: "Admin", icon: Settings },
];

/** The queues worth a shortcut under Work: what is mine, what nobody has looked at, what is late. */
const QUEUES: { inbox: "mine" | "needs_review" | "overdue"; label: string }[] = [
  { inbox: "mine", label: "Assigned to me" },
  { inbox: "needs_review", label: "Unassigned / needs review" },
  { inbox: "overdue", label: "Overdue" },
];

const linkClass =
  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/** A number that only shows when there is something to look at; the words go to screen readers. */
function Count({ n, what }: { n: number | undefined; what: string }) {
  if (!n) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-auto min-w-6 rounded-full bg-brand-tint px-1.5 text-center font-mono text-xs font-semibold text-brand-text tabular">
        {n}
      </span>
      <span className="sr-only">
        , {n} {what}
      </span>
    </>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const path = usePathname();
  const params = useSearchParams();
  const { counts } = useCounts();
  const inbox = params.get("inbox") ?? "mine";
  return (
    <nav aria-label="Console" className="grid gap-1">
      {NAV.filter((n) => !n.admin || me.role === "admin").map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href : path.startsWith(href);
        return (
          <div key={href} className="grid gap-1">
            <Link
              href={href}
              data-tour={`console-${label.toLowerCase()}`}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(linkClass, active && "bg-muted text-foreground")}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {label}
              {label === "Approvals" && <Count n={counts?.approvals} what="waiting" />}
            </Link>
            {label === "Work" &&
              QUEUES.map((q) => (
                <Link
                  key={q.inbox}
                  href={`/console?inbox=${q.inbox}`}
                  onClick={onNavigate}
                  className={cn(linkClass, "min-h-9 pl-11 font-medium", path === "/console" && inbox === q.inbox && "text-foreground")}
                >
                  {q.label}
                  <Count n={counts?.[q.inbox]} what={q.inbox === "overdue" ? "overdue" : "to look at"} />
                </Link>
              ))}
          </div>
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
    <CountsProvider>
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
                <Suspense>
                  <NavLinks onNavigate={() => setOpen(false)} />
                </Suspense>
              </SheetContent>
            </Sheet>
            <Brand href="/console" tone="dark" />
            <span className="hidden text-sm text-band-muted sm:inline">Console</span>
            <div className="ml-auto flex items-center gap-1">
              <Button asChild variant="ghost" className="h-11 gap-1.5 rounded-full px-3 text-band-foreground hover:bg-white/10 hover:text-band-foreground">
                <Link href="/" data-tour="nav-home">
                  <House className="size-5" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Smoke Signal home</span>
                </Link>
              </Button>
              <GuideButton area="console" tone="dark" />
              <NotificationBell tone="dark" />
              <UserMenu tone="dark" />
            </div>
          </div>
        </header>
        <div className="flex flex-1">
          <aside className="sticky top-[60px] hidden h-[calc(100dvh-60px)] w-56 shrink-0 border-r bg-card p-3 lg:block">
            <Suspense>
              <NavLinks />
            </Suspense>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </CountsProvider>
  );
}
