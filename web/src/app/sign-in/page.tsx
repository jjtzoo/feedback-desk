"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { BrandMark, Stripe } from "@/components/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, errorText } from "@/lib/api";
import { initials } from "@/lib/format";

interface DevUser {
  email: string;
  name: string;
  role: "staff" | "digital" | "admin";
}

const ERRORS: Record<string, string> = {
  domain: "Feedback is only for REDADAIR Google accounts. Sign in with your redadair.com.au account.",
  state: "That sign-in link expired. Please try again.",
  google: "Google sign-in didn't work. Please try again.",
};
const ROLE: Record<DevUser["role"], string> = { staff: "Staff", digital: "Digital Staff", admin: "Admin" };

function SignIn() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next") ?? "/";
  const [options, setOptions] = useState<{ google: boolean; dev_login: boolean } | null>(null);
  const [people, setPeople] = useState<DevUser[]>([]);
  const [error, setError] = useState<string | null>(params.get("error") ? (ERRORS[params.get("error") ?? ""] ?? ERRORS.google) : null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ google: boolean; dev_login: boolean }>("/auth/options").then((o) => {
      setOptions(o);
      if (o.dev_login) api.get<DevUser[]>("/auth/dev/users").then(setPeople).catch(() => undefined);
    }).catch((e: unknown) => setError(errorText(e)));
  }, []);

  async function devSignIn(email: string) {
    setBusy(email);
    setError(null);
    try {
      await api.post("/auth/dev/sign-in", { email });
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Stripe />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-lg font-extrabold">
            <BrandMark /> Feedback
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-muted-foreground">Use your REDADAIR Google account. No separate password is needed.</p>

          {error && (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {options?.google ? (
            <Button asChild className="mt-6 h-12 w-full rounded-xl text-base">
              {/* A full navigation: Google's sign-in page, via the API. */}
              <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>
                Continue with Google <ArrowRight />
              </a>
            </Button>
          ) : (
            <Button className="mt-6 h-12 w-full rounded-xl text-base" disabled>
              Continue with Google <ArrowRight />
            </Button>
          )}
          {options && !options.google && (
            <p className="mt-2 text-sm text-muted-foreground">Google sign-in is not yet configured on this server.</p>
          )}
          <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Only redadair.com.au accounts can sign in.
          </p>

          {options?.dev_login && people.length > 0 && (
            <div className="mt-8 rounded-2xl border border-dashed bg-card p-4">
              <p className="text-sm font-semibold">Local development sign-in</p>
              <p className="mb-3 text-xs text-muted-foreground">Placeholder people from the seed. This only exists locally (spec D23).</p>
              <ul className="grid gap-1">
                {people.map((p) => (
                  <li key={p.email}>
                    <button
                      type="button"
                      onClick={() => devSignIn(p.email)}
                      disabled={busy !== null}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-muted disabled:opacity-60"
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand-text">{initials(p.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{busy === p.email ? "Signing in…" : ROLE[p.role]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
