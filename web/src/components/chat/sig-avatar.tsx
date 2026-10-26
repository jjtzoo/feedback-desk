import type { CSSProperties } from "react";

import { Puff } from "@/components/brand";
import { cn } from "@/lib/utils";

export type SigState = "ready" | "writing" | "sent" | "offline";

/** A short reaction that plays on top of the state (docs/research/sig-motion-interactions.md, part 3). */
export type SigReaction = "pop" | "look-down" | "nod" | "wow" | "tilt" | "lean" | "hop-puff" | "double-hop" | "glitch" | "slump" | "wink";

/** How long each reaction plays. Held poses (look-down, wow, lean, slump) stay until the panel clears them. */
const DURATION: Record<SigReaction, number> = {
  pop: 600,
  "look-down": 200,
  nod: 400,
  wow: 200,
  tilt: 600,
  lean: 300,
  "hop-puff": 1200,
  "double-hop": 700,
  glitch: 700,
  slump: 500,
  wink: 500,
};

/** Sig, the Smoke Signal assistant (D37): a smart extinguisher. Flat art for the product; 3D is for large moments.
 *  Motion lives in globals.css; with reduced motion on, a reaction is a face swap only. */
export function SigAvatar({
  state = "ready",
  reaction,
  onReactionEnd,
  onClick,
  className,
}: {
  state?: SigState;
  reaction?: SigReaction | null;
  onReactionEnd?: () => void;
  onClick?: () => void;
  className?: string;
}) {
  const offline = state === "offline";
  return (
    <span
      className={cn("relative grid size-8 shrink-0 place-items-center rounded-full bg-muted text-foreground", className)}
      style={reaction ? ({ "--sig-d": `${DURATION[reaction]}ms` } as CSSProperties) : undefined}
      data-state={state}
      aria-hidden="true"
      onClick={onClick}
    >
      <svg viewBox="0 0 64 64" className={cn("size-[82%]", state === "ready" && "animate-breathe")}>
        <g
          data-sig-body=""
          data-reaction={reaction ?? undefined}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) onReactionEnd?.();
          }}
        >
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
          <SigFace state={state} reaction={reaction ?? null} />
        </g>
      </svg>
      {reaction === "hop-puff" && (
        <span data-sig-puff="" className="absolute -top-2 left-0 size-5 text-muted-foreground">
          <Puff className="size-full" />
        </span>
      )}
    </span>
  );
}

const EYE = "fill-primary-foreground";

function SigFace({ state, reaction }: { state: SigState; reaction: SigReaction | null }) {
  if (reaction === "look-down")
    return (
      <>
        <rect x="26.3" y="36" width="3.4" height="5.4" rx="1.7" className={EYE} />
        <rect x="34.3" y="36" width="3.4" height="5.4" rx="1.7" className={EYE} />
        <rect x="28.5" y="43.2" width="7" height="2.2" rx="1.1" className="fill-primary" />
      </>
    );
  if (reaction === "wow")
    return (
      <>
        <circle cx="28" cy="36.4" r="2.7" className={EYE} />
        <circle cx="36" cy="36.4" r="2.7" className={EYE} />
        <circle cx="32" cy="43.4" r="1.7" className="fill-primary" />
      </>
    );
  if (reaction === "tilt")
    return (
      <>
        <rect x="33.6" y="31.4" width="4.8" height="1.6" rx="0.8" transform="rotate(-12 36 32.2)" className={EYE} />
        <rect x="26.3" y="35" width="3.4" height="5.4" rx="1.7" className={EYE} />
        <rect x="34.3" y="34.4" width="3.4" height="6" rx="1.7" className={EYE} />
        <rect x="29.5" y="42.6" width="5" height="2.2" rx="1.1" className="fill-primary" />
      </>
    );
  if (reaction === "wink")
    return (
      <>
        <rect x="26.3" y="33" width="3.4" height="7" rx="1.7" className={EYE} />
        <path d="M33.8 37.6q2.2-3.2 4.4 0" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-primary-foreground" />
        <rect x="28.5" y="42.4" width="7" height="2.4" rx="1.2" className="fill-primary" />
      </>
    );
  if (reaction === "glitch")
    return (
      <>
        <g data-sig-part="static" className={EYE} opacity={0.75}>
          <rect x="23" y="33" width="12" height="1.4" />
          <rect x="27" y="36.5" width="13" height="1.4" />
          <rect x="24" y="40" width="9" height="1.4" />
          <rect x="29" y="43.5" width="11" height="1.4" />
        </g>
        <g data-sig-part="worried">
          <path d="M25.8 33.6L30 32.2M34 32.2L38.2 33.6" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-primary-foreground" />
          <rect x="26.6" y="35" width="3" height="4.6" rx="1.5" className={EYE} />
          <rect x="34.4" y="35" width="3" height="4.6" rx="1.5" className={EYE} />
          <path d="M28.6 44.8q3.4-2.6 6.8 0" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-primary" />
        </g>
      </>
    );
  if (state === "writing")
    return (
      <>
        <rect x="27.8" y="32" width="3.4" height="5.4" rx="1.7" className={EYE} />
        <rect x="35.8" y="32" width="3.4" height="5.4" rx="1.7" className={EYE} />
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
        <rect x="25.8" y="37" width="4.6" height="2" rx="1" className={EYE} />
        <rect x="33.6" y="37" width="4.6" height="2" rx="1" className={EYE} />
        <rect x="28.5" y="42.6" width="7" height="2" rx="1" className={EYE} />
      </>
    );
  return (
    <>
      <g data-sig-part="eyes">
        <rect x="26.3" y="33" width="3.4" height="7" rx="1.7" className={EYE} />
        <rect x="34.3" y="33" width="3.4" height="7" rx="1.7" className={EYE} />
      </g>
      {reaction === "pop" && (
        <g data-sig-part="lids" opacity={0} className={EYE}>
          <rect x="26.3" y="36" width="3.4" height="1.4" rx="0.7" />
          <rect x="34.3" y="36" width="3.4" height="1.4" rx="0.7" />
        </g>
      )}
      <rect x="28.5" y="42.4" width="7" height="2.4" rx="1.2" className="fill-primary" />
    </>
  );
}
