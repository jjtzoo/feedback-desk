import { cn } from "@/lib/utils";

export type SigState = "ready" | "writing" | "sent" | "offline";

/** Sig, the Smoke Signal assistant (D37): a smart extinguisher. Flat art for the product; 3D is for large moments. */
export function SigAvatar({ state = "ready", className }: { state?: SigState; className?: string }) {
  const offline = state === "offline";
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 64 64" className={cn("size-[82%]", state === "ready" && "animate-breathe")}>
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <path d="M25 13C13 12 8 22 10 32" strokeWidth="3" />
          <path d="M18 40Q11 39 10 34" strokeWidth="3.5" />
          <path d="M46 40Q54 36 55.5 27" strokeWidth="3.5" />
        </g>
        <g fill="currentColor">
          <circle cx="10" cy="33.5" r="2.8" />
          <path d="M8.2 31L5.8 24L8.6 23.2L11.2 30.4Z" />
          <circle cx="55.8" cy="25.5" r="2.8" />
          <ellipse cx="25" cy="61" rx="5" ry="2.4" />
          <ellipse cx="39" cy="61" rx="5" ry="2.4" />
        </g>
        <path d="M18 30A14 14 0 0 1 46 30V56Q46 60 42 60H22Q18 60 18 56Z" className={offline ? "fill-muted-foreground" : "fill-primary"} />
        <g fill="currentColor">
          <rect x="29.5" y="14" width="5" height="4" />
          <rect x="26.5" y="9" width="11" height="7" rx="2" />
          <rect x="29" y="5" width="17" height="3" rx="1.5" transform="rotate(-10 32 7)" />
        </g>
        <rect x="22" y="30" width="20" height="17" rx="4" className="fill-band" />
        <SigFace state={state} />
      </svg>
    </span>
  );
}

function SigFace({ state }: { state: SigState }) {
  if (state === "writing")
    return (
      <>
        <rect x="27.8" y="32" width="3.4" height="5.4" rx="1.7" className="fill-primary-foreground" />
        <rect x="35.8" y="32" width="3.4" height="5.4" rx="1.7" className="fill-primary-foreground" />
        <rect x="30" y="42.4" width="4" height="2.4" rx="1.2" className="fill-primary" />
      </>
    );
  if (state === "sent")
    return (
      <>
        <path d="M25.8 38.2q2.2-3.2 4.4 0M33.8 38.2q2.2-3.2 4.4 0" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-primary-foreground" />
        <rect x="28.5" y="42.4" width="7" height="2.4" rx="1.2" className="fill-primary" />
      </>
    );
  if (state === "offline")
    return (
      <>
        <rect x="25.8" y="37" width="4.6" height="2" rx="1" className="fill-primary-foreground" />
        <rect x="33.6" y="37" width="4.6" height="2" rx="1" className="fill-primary-foreground" />
        <rect x="28.5" y="42.6" width="7" height="2" rx="1" className="fill-primary-foreground" />
      </>
    );
  return (
    <>
      <rect x="26.3" y="33" width="3.4" height="7" rx="1.7" className="fill-primary-foreground" />
      <rect x="34.3" y="33" width="3.4" height="7" rx="1.7" className="fill-primary-foreground" />
      <rect x="28.5" y="42.4" width="7" height="2.4" rx="1.2" className="fill-primary" />
    </>
  );
}
