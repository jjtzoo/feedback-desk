"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ChatPanel } from "@/components/chat/chat-panel";
import { STARTERS } from "@/components/chat/starters";

/** The conversation, on its own page. `?project=` preselects a tool; `?start=` pre-fills a starter. */
function Chat() {
  const params = useSearchParams();
  const starter = STARTERS.find((s) => s.id === params.get("start"));
  return (
    <div data-page="fill" className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Give feedback</h1>
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
