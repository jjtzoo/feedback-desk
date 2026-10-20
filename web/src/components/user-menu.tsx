"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useMe } from "@/components/me";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE: Record<string, string> = { staff: "Staff", digital: "Digital Staff", admin: "Admin" };

export function UserMenu({ tone = "light" }: { tone?: "light" | "dark" }) {
  const me = useMe();
  const router = useRouter();

  async function signOut() {
    await api.post("/auth/signout").catch(() => undefined);
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("h-11 gap-2 rounded-full pr-3 pl-1.5", tone === "dark" && "text-band-foreground hover:bg-white/10 hover:text-band-foreground")}
          aria-label={`Account: ${me.name}`}
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-muted text-xs font-bold">{initials(me.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-semibold sm:inline">{me.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate">{me.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {me.email} · {ROLE[me.role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/chat">
            Give feedback
          </Link>
        </DropdownMenuItem>
        {me.role !== "staff" && (
          <DropdownMenuItem asChild className="min-h-11">
            <Link href="/console">
              Open the console
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="min-h-11">
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
