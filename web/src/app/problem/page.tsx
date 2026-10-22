import Link from "next/link";

import { BrandMark, Stripe } from "@/components/brand";
import { Button } from "@/components/ui/button";

const COPY: Record<string, { title: string; body: string }> = {
  "403": { title: "You can't open that", body: "Your account doesn't have access to this page. If you think it should, ask the Digital team." },
  "404": { title: "We can't find that", body: "The page or item you asked for doesn't exist, or it isn't yours to see." },
};

export default async function ProblemPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const copy = COPY[status ?? ""] ?? COPY["404"];
  return (
    <div className="flex min-h-dvh flex-col">
      <Stripe />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-lg font-extrabold">
            <BrandMark /> Smoke Signal
          </div>
          <h1 className="text-2xl font-bold">{copy.title}</h1>
          <p className="mt-2 text-muted-foreground">{copy.body}</p>
          <Button asChild className="mt-6 rounded-xl">
            <Link href="/">Back to Smoke Signal</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
