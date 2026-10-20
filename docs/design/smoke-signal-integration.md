# Smoke Signal brand and Sig, the assistant: implementation brief

> **Status: OPEN (spec D37).** Build this on a branch and show it on staging. It goes to `main` only after Marc approves D37.
> The artwork is already in `web/public/brand/`. This brief covers wiring it into the app. Written 2026-10-21.

Read `CLAUDE.md` and `web/AGENTS.md` before starting. This Next.js version differs from older docs, so check `node_modules/next/dist/docs/` for anything about metadata, icons or `next/image`. Other work may have landed since this brief was written, so read each file's current content before editing it.

## The idea

- **The smoke is the feedback.** Good or bad, staff send it up as a signal. The logo is **Puff**, a puff of smoke shaped like a speech bubble.
- **Sig answers it.** The chat assistant is **Sig**, a smart fire extinguisher with a screen face. It deals with a problem while it is still smoke, before it grows into a fire nobody can control. That is the point of the app: catch it early and fix it.
- **Why the extinguisher (enterprise pick):** it is the group's own kit, so it can't be mistaken for a real brigade, a real person or anyone else's mascot. It already exists as a full system (flat, 3D, four states, light and dark). The screen face and an AI tag make it plainly an assistant.
- **Name:** the product becomes **Smoke Signal**. The intranet tile keeps the plain word **Feedback**, so staff can still find it (D15 stays true for the tile).

Design record: the "Feedback Desk assistant avatar" design canvas, https://claude.ai/artifact/JUynzQ9SBAUKSYEGd4rorn (private to its owner). The "Final avatar decision" board has the scoring and every pro and con.

## What's already in the repo

| File (under `web/public/brand/`) | What it is | Use it for |
| --- | --- | --- |
| `smoke-signal-mark.svg` | Puff, ink on transparent | Light surfaces, 24 px and up |
| `smoke-signal-mark-reversed.svg` | Puff, white on transparent | The charcoal band and dark surfaces |
| `smoke-signal-icon.svg` | White Puff on a red rounded square | Favicon; the art inside `BrandMark` |
| `smoke-signal-icon-32.png`, `-192.png`, `-512.png` | The icon as PNG | Where SVG isn't accepted; give the 512 to IT for the intranet tile |
| `apple-touch-icon.png` | 180 × 180, full bleed, opaque | iOS home-screen icon |
| `sig/sig-ready.svg`, `sig-writing.svg`, `sig-sent.svg`, `sig-offline.svg` | Flat Sig, light theme | The source of truth for `SigAvatar`; `<img>` use outside the app |
| `sig/sig-*-dark.svg` | The same four states for dark surfaces | As above |
| `sig/sig-3d.svg` | Sig in 3D, full figure (200 × 240) | Large moments only (see Rules) |
| `sig/sig-3d-avatar.svg` | 3D, head-and-shoulders crop | Profile pictures outside the app (Google Chat, Teams) |
| `sig/sig-3d-512.png`, `sig/sig-3d-hero.png` | PNG renders of the two above | Email, slides, intranet news |

Colours match the tokens in `web/src/app/globals.css`: red `--primary` `#D0101B`, ink `--foreground`/`--band` `#14161A`, dark foreground `#F2F3F5`. The PNGs were rendered from the SVGs with headless Chromium; re-render them the same way if an SVG changes.

The 3D art is a vector stand-in. Once D37 is approved, commission a proper render using `sig-3d.svg` as the reference, and keep the source files in approved company storage (D27).

## Rules

1. **Flat in the product, 3D for large moments.** Use the flat `SigAvatar` in the chat header, messages and notifications. Use the 3D Sig on the landing page, empty states, onboarding and internal comms, and never below 96 px tall.
2. **Colours come from tokens.** Components never contain hex values (globals.css says so). The snippets below use `currentColor` and Tailwind theme classes (`fill-primary`, `fill-band`, `fill-muted-foreground`, `fill-primary-foreground`).
3. **Always say it's AI.** Wherever Sig speaks, its name has an `AI` tag beside it, and the staff footer says chats are processed by Google's Gemini model.
4. **Puff is the logo; Sig is never the logo.** The favicon, `BrandMark` and the tile all use Puff.
5. **Motion.** The Ready state gets a slow idle swell: 5 s, scale 1 to 1.04. Nothing loops while Sig is writing. With reduced motion on, there is no swell.
6. **Status is never shown by the face alone.** Every state also has words, such as "Sig is writing…" or "Sig isn't available right now".
7. **Words.** Sig puts out *problems*, never people's comments. Don't write copy that "puts out", "extinguishes" or "hoses down" feedback. Praise gets passed on to the team.
8. **Accessibility.** The avatar is decorative (`aria-hidden`) wherever the name "Sig" is in the text beside it. 3D illustrations use `alt=""` unless they carry meaning. Sig's face must read at 32 px on `bg-muted` in both themes.

## Changes, file by file

### 1. `web/src/app/globals.css`: the idle swell

Add after the `lift` utility:

```css
@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}

/* Sig's idle swell (D37): the only new looping motion. It stops under reduced motion. */
@utility animate-breathe {
  animation: breathe 5s ease-in-out infinite;
  transform-origin: 50% 90%;
}
```

Then add `.animate-breathe` to the "Loops stop" rule inside `@media (prefers-reduced-motion: reduce)`, next to `.animate-spin` and `.animate-pulse`.

### 2. `web/src/components/chat/sig-avatar.tsx` (new), replacing `assistant-avatar.tsx`

Delete `assistant-avatar.tsx` and update its two imports (`chat-panel.tsx`, `(staff)/page.tsx`). The paths below are the flat art from `public/brand/sig/sig-ready.svg`, with the colours swapped for tokens:

```tsx
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
```

### 3. `web/src/components/brand.tsx`: Puff in the mark, the new wordmark

`BrandMark` keeps its 32 px red rounded square and swaps the Lucide icon for Puff (the art from `smoke-signal-icon.svg`). Remove the `MessageSquareText` import.

```tsx
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-[9px] bg-primary text-primary-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="size-[26px]">
        <g fill="currentColor">
          <path d="M18 46Q12 54 6 58Q16 59 26 49Z" />
          <circle cx="21" cy="30" r="10" />
          <circle cx="33" cy="25" r="12" />
          <circle cx="44" cy="32" r="9" />
          <circle cx="16" cy="42" r="8" />
          <circle cx="47" cy="43" r="7" />
          <rect x="12" y="30" width="40" height="20" rx="10" />
          <circle cx="4.5" cy="27" r="3.2" />
          <circle cx="57.2" cy="25" r="3.2" />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round">
          <path d="M12 38Q5 36 4.5 29" />
          <path d="M50 37Q56 34 57 27" />
        </g>
        <circle cx="56" cy="14.5" r="4.2" fill="currentColor" fillOpacity={0.6} />
        <circle cx="60.5" cy="6" r="2.6" fill="currentColor" fillOpacity={0.4} />
        <rect x="25" y="30" width="4" height="9" rx="2" className="fill-band" />
        <rect x="36" y="30" width="4" height="9" rx="2" className="fill-band" />
        <rect x="27" y="42" width="11" height="3.2" rx="1.6" className="fill-primary" />
      </svg>
    </span>
  );
}
```

In `Brand`, change the wordmark text from `Feedback` to `Smoke Signal`. The staff header, the console header (`tone="dark"`) and the sign-in page all pick up the change.

### 4. `web/src/app/layout.tsx`: title and icons

- `title: { default: "Smoke Signal", template: "%s · Smoke Signal" }`.
- Replace the `icons` data URI with the files already in `public/`: `icons: { icon: "/brand/smoke-signal-icon.svg", apple: "/brand/apple-touch-icon.png" }`. Check the metadata docs in `node_modules/next/dist/docs/` for the exact shape in this version.

### 5. `web/src/components/chat/chat-panel.tsx`: Sig in the chat

- Import `SigAvatar` and `SigState`. Derive the state from what the panel already knows:
  `const sig: SigState = mode === "fallback" ? "offline" : mode === "done" ? "sent" : busy ? "writing" : "ready";`
- Replace the header with Sig's name, an AI tag and a subtitle:

```tsx
<header className="flex items-center gap-3 border-b px-5 py-4">
  <SigAvatar state={sig} className="size-12" />
  <div>
    <p className="flex items-center gap-2 font-bold">
      Sig <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">AI</span>
    </p>
    <p className="text-sm text-muted-foreground">{sig === "offline" ? "Not available right now" : "Smoke Signal's feedback assistant"}</p>
  </div>
</header>
```

- The section's `aria-label` becomes "Chat with Sig, the feedback assistant". The screen-reader prefix `Assistant: ` becomes `Sig: `. The busy line `Thinking…` becomes `Sig is writing…` (it stays inside the `aria-live` list).

### 6. Other screens

| File | Change |
| --- | --- |
| `web/src/app/(staff)/page.tsx` | The decorative chat preview uses `SigAvatar` (`size-11`), the name "Sig" with the AI tag, and the first bubble "G'day, I'm Sig. Spotted something?". In the "Your recent feedback" empty state, add the 3D Sig above the line, 96 px tall. |
| `web/src/app/(staff)/my/page.tsx` | Empty state ("No feedback yet…"): add the 3D Sig above the text, 120 px tall. |
| `web/src/components/chat/done-view.tsx` | Add `<SigAvatar state="sent" className="size-14" />` above the heading. Keep the heading text. |
| `web/src/components/chat/backup-form.tsx` | Copy only (see the table below). The chat header already shows Sig offline. |

For the 3D art, use `next/image` with `unoptimized` so the SVG is served as is, and check the docs for SVG handling in this version:
`<Image src="/brand/sig/sig-3d.svg" alt="" width={80} height={96} unoptimized />` (keep the 200 × 240 ratio).

### 7. Copy

| File | Now | New |
| --- | --- | --- |
| `web/src/app/sign-in/page.tsx` | `<BrandMark /> Feedback` | `<BrandMark /> Smoke Signal` |
| `web/src/app/sign-in/page.tsx` | "Feedback is only for REDADAIR Google accounts…" | "Smoke Signal is only for REDADAIR Google accounts…" |
| `web/src/components/guide.tsx` | "Welcome to Feedback" | "Welcome to Smoke Signal" |
| `web/src/components/guide.tsx` | "The assistant asks up to three short questions." | "Sig, the assistant, asks up to three short questions." |
| `web/src/app/(staff)/page.tsx` | STEPS: "The assistant asks only what the team needs…" | "Sig, the assistant, asks only what the team needs…" |
| `web/src/app/(staff)/track/[ref]/page.tsx` | `` `… · Feedback` `` (document title) | `` `… · Smoke Signal` `` |
| `web/src/components/chat/backup-form.tsx` | "The assistant isn't available right now." | "Sig isn't available right now." |
| `web/src/components/chat/backup-form.tsx` | "You've used today's assistant allowance. It resets tomorrow." | "You've used today's allowance with Sig. It resets tomorrow." |
| `web/src/components/chat/backup-form.tsx` | "The assistant is paused for today to keep costs in check." | "Sig is paused for today to keep costs in check." |
| `web/src/components/staff-header.tsx` | Footer: "…Chats are processed by Google's Gemini model…" | "…Sig is an AI assistant, and chats are processed by Google's Gemini model…" |
| `backend/app/agent_runtime.py` | `GREETING = "G'day! What's on your mind? …"` | `"G'day, I'm Sig. Spotted something? Tell me what's not working, or what would make one of our tools better."` |
| `backend/agent/instruction.md` | "You are Feedback, REDADAIR's feedback assistant." | "You are Sig, the assistant in Smoke Signal, REDADAIR's feedback app." Add to Rules: "You catch problems early. Never talk about putting out or shutting down people's feedback." |
| `backend/app/services/email.py` | `FOOTER`: "Feedback, REDADAIR Digital team." | "Smoke Signal, REDADAIR Digital team." |
| `backend/app/config.py` | `mail_from` default "Feedback <noreply@…>" | "Smoke Signal <noreply@…>". Also check `.env.example` and `deploy/` for `MAIL_FROM`. |

Then search for any test that asserts the old strings and update it, for example `rg -n "What's on your mind|You are Feedback|Feedback, REDADAIR|Feedback assistant" backend web/src`.

### 8. Docs in the same change

- **Spec:** move D37 from OPEN to decided (date and who approved), and change D15's product name. Keep the master copy outside the repo in sync, as `CLAUDE.md` says.
- **README:** the product name, and remove D37 from the open-decisions line.
- **`.claude/skills/fire-services-ui/SKILL.md`:** the assistant avatar is Sig. Flat in the product, 3D for large moments, the idle swell only on Ready.
- **`CLAUDE.md`, UI section:** one line saying that brand assets live in `web/public/brand/`, with a link to this brief.

## Checks

- `cd web && npm run lint && npm run typecheck && npm run build`
- `cd backend && uv run ruff check . && uv run mypy && uv run pytest`
- The agent instruction changed, so run `uv run python -m evals.run_routing`. The gate is 85 % project, 85 % work type and 80 % assignee on Gemini.
- In a browser, at 375 px and on desktop, in light and dark:
  - the header mark in all three headers
  - the chat header in all four states: ready; writing while a reply streams; offline through the backup form; sent after Confirm
  - the landing preview
  - both empty states
  - the favicon and the iOS home-screen icon
- With reduced motion on, there is no swell. The keyboard focus order is unchanged.

## Acceptance

- [ ] `BrandMark` shows Puff in the staff header, console header and sign-in page; the wordmark reads Smoke Signal.
- [ ] The favicon and apple-touch icon are the Puff icon.
- [ ] The chat header shows `SigAvatar` in the right state (ready, writing, sent, offline), with the name "Sig" and an AI tag.
- [ ] The only new looping animation is the Ready swell, and it stops under reduced motion.
- [ ] The 3D Sig appears only at 96 px tall or larger.
- [ ] No hex values in components; no "Feedback assistant" strings left; `assistant-avatar.tsx` is gone and has no leftover imports.
- [ ] Lint, typecheck, build, backend tests and the routing gate all pass.
- [ ] The spec, README, skill and `CLAUDE.md` are updated.

## Branch and release

- One branch, `ui/smoke-signal-brand`, with the web and backend copy changes in separate commits. Never commit to `main`. Commit or push only when the user asks (`CLAUDE.md`).
- Open the pull request into `staging`, deploy to staging with the checklists in `docs/deployment.md`, and ask Marc to review it there.
- It goes to `main` only when D37 is approved. If Marc approves Sig but not the name, keep the avatar and revert the name and wordmark changes.

## Out of scope

- The final 3D render. Commission it after approval.
- The intranet tile, which IT owns. Give them `smoke-signal-icon-512.png` and the word "Feedback".
- HTML email. Emails are plain text today; a logo can come with an HTML template later.
