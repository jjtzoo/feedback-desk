"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { Saved } from "@/lib/api";

/** After submitting: the reference and who it went to (brief §4.1.7), with a link to the tracker. */
export function DoneView({ saved, plusOne, onAgain }: { saved: Saved; plusOne: boolean; onAgain: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const waiting = saved.status === "awaiting_approval" || saved.status === "needs_review";
  return (
    <section className="animate-fade-up p-6 sm:p-8" aria-live="polite">
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">
        {plusOne ? "Added to " : "Sent. Your reference is "}
        <span className="font-mono">{saved.reference}</span>
      </h2>
      <p className="mt-3 max-w-prose text-muted-foreground">
        {plusOne
          ? `Your comment is on ${saved.reference}, which is with ${saved.assigned_to}. You'll get its updates too.`
          : `It's with ${saved.assigned_to}. ${waiting ? "An Admin will approve it before work starts. " : ""}You'll get updates here and by email.`}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild className="h-11 rounded-xl px-5 text-base">
          <Link href={`/track/${saved.reference}`}>
            Track it <ArrowRight />
          </Link>
        </Button>
        <Button variant="outline" className="h-11 rounded-xl px-5 text-base" onClick={onAgain}>
          Give more feedback
        </Button>
      </div>
    </section>
  );
}
