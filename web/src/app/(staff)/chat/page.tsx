"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ChatPanel } from "@/components/chat/chat-panel";
import { STARTERS } from "@/components/chat/starters";

/** The conversation, on its own page. `?project=` preselects a tool; `?start=` pre-fills a starter. */
function Chat() {
  const params = useSearchParams();
  const starter = STARTERS.find((s) => s.id === params.get("start"));
  return (
    <div className="mx-auto max-w-3xl px-4 pt-3 pb-12 sm:px-6">
      <h1 className="sr-only">Give feedback</h1>
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to home
      </Link>
      <ChatPanel projectSlug={params.get("project")} starterText={starter?.text} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
