---
name: fire-services-ui
description: Design and build web UI for fire protection and emergency services teams - internal tools, ticket queues, dashboards, report and inspection forms, and status pages. Use when building or restyling screens for a fire services business (including Feedback Desk for the Redadair group), when asked for the "fire services" or "signal red" look, or when choosing colors, type, layout or motion for such an app.
---

# Fire Services UI

A design skill for apps used by fire protection and emergency services people: technicians in the field on a phone, office staff at a desk, IT devs working a queue. The look is confident and industrial: charcoal and white with one hard red, condensed uppercase headings, plain language. The feel is calm. An emergency services brand already carries urgency; the interface must not add panic.

It builds on two sources and keeps what fits a working tool:
- **taste-skill** (Leonxlnx/taste-skill, v1): bias correction against generic AI layouts, one accent, full interaction states, no filler copy.
- **Apple Human Interface Guidelines**: clarity, deference to content, consistency, 44 px touch targets, text that scales, motion only when it explains something.

The palette is drawn from redmen.com.au (a Sydney fire protection company): bright safety red on charcoal and off-white. Use the colors as inspiration only. Never use another company's name, logo or imagery.

## 1. Baseline dials

| Dial | Value | Meaning here |
| --- | --- | --- |
| DESIGN_VARIANCE | 3 | Predictable grids. People scan these screens under time pressure; layouts stay where they expect them. Marketing or landing pages may go to 5. |
| MOTION_INTENSITY | 4 | Apple-style: springy entrances, press and lift feedback, staggered lists. No idle loops, with one exception: the assistant avatar, Sig (D37, D49), is a functional mark: its face shows the state, and it moves only while it writes (a gentle pulse beside "Sig is writing…"). No idle swell, no decorative reactions. Feedback is light only (D48). Sig is flat in the product (`SigAvatar`) and 3D (at least 96 px tall) only for large moments such as empty states, the landing page and internal comms; Puff, not Sig, is the logo. Raised from 2 at the user's request, 2026-10-20. |
| VISUAL_DENSITY | 4 public screens, 7 staff screens | Forms and status pages breathe; queues and lists are compact, separated by lines instead of cards. |

Follow these unless the user asks for something else in chat. Do not ask the user to edit this file.

## 2. Color

### Tokens

Define colors once as CSS variables (or Tailwind theme colors that read them). Never write a hex value in a component.

```css
:root {
  --signal:        #E60000; /* brand red: primary buttons, active nav, focus ring, key marks */
  --signal-press:  #B80000; /* pressed / hover on red */
  --signal-tint:   #FDECEC; /* red-tinted backgrounds: high-urgency badge, error field */
  --signal-text:   #B80000; /* red text on white or on --signal-tint (6:1) */
  --ink:           #111111; /* headings and body text (never pure #000) */
  --charcoal:      #54595F; /* secondary text, icons, dark bands */
  --slate:         #69727D; /* borders that must be seen, disabled text */
  --line:          #E3E5E8; /* dividers and quiet borders */
  --canvas:        #F9F9F9; /* page background */
  --surface:       #FFFFFF; /* panels, inputs, sheets */
  --amber:         #B45309; /* medium urgency, warnings (text-safe amber) */
  --amber-tint:    #FEF3C7;
  --green:         #15803D; /* resolved / done */
  --green-tint:    #DCFCE7;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --signal:       #FF4D4D; /* lighter red so red text passes 4.5:1 on dark */
    --signal-press: #E60000;
    --signal-tint:  #3A1214;
    --signal-text:  #FF6B6B;
    --ink:          #F2F2F2;
    --charcoal:     #B4BAC1;
    --slate:        #8B939C;
    --line:         #2A2D31;
    --canvas:       #111111;
    --surface:      #1B1D20;
    --amber:        #F5B041;
    --amber-tint:   #3A2A10;
    --green:        #4ADE80;
    --green-tint:   #12301D;
  }
}
```

Mirror the dark block under `:root[data-theme="dark"]` if the app has a theme switch. On dark backgrounds, solid red buttons keep `#E60000` with white text. All red *text* (badges, errors, destructive links) uses `--signal-text`, which is tuned per theme to pass 4.5:1 on both the surface and the red tint.

### Rules

- **60 / 30 / 10.** Neutrals (canvas, surface, ink) carry about 60 % of the screen, charcoal about 30 %, red 10 % at most. If red is everywhere, nothing is urgent.
- **One accent.** Red is the only brand accent. Amber and green are status colors, never decoration.
- **Red means "act here" or "this is urgent", nothing else.** One solid red button per view: the primary action. Secondary buttons are charcoal outline or plain text.
- **Never color alone.** Urgency and status always pair color with a word and an icon ("High" with a warning icon), so they read in grayscale and for color-blind users.
- **No gradients, glows or neon.** No flame imagery, fire gradients or orange-to-red ramps. Solid fills only.
- **Contrast.** Body text 4.5:1, large text and icons 3:1, in both themes. `#E60000` on white is 4.8:1; `#54595F` on white is 7.1:1. Check any new pair before using it.
- **Charcoal bands.** A full-width `--charcoal` or `--ink` band (header, footer, a hero strip) with white text is the signature move. Use at most one band per screen besides the header.

## 3. Typography

| Role | Font | Style |
| --- | --- | --- |
| Display and headings | Barlow Condensed | 700, UPPERCASE, letter-spacing 0.01em, line-height 1.05 |
| Body and UI | Barlow | 400 body, 500 labels, 600 emphasis |
| References, IDs, times, counts | JetBrains Mono | 500, tabular numbers |

- These are free (OFL) stand-ins for the condensed display face and humanist sans the reference site uses. Self-host them with `@fontsource/barlow`, `@fontsource/barlow-condensed` and `@fontsource/jetbrains-mono`. No font CDN on internal tools.
- Fallback stacks: `"Barlow Condensed", "Arial Narrow", Arial, sans-serif` and `Barlow, Arial, sans-serif`.
- Uppercase is for headings, section labels and badges only. Never set body text, buttons longer than three words, or form labels in caps.
- Scale (rem, so browser text size works the way Dynamic Type does on Apple platforms): 0.875 caption, 1 body, 1.125 lead, 1.5 h3, 2 h2, 2.5 to 3 h1 on public pages. Staff screens cap h1 at 2 rem.
- Body lines max 65 characters. Line-height 1.5 for body, 1.3 for UI rows.
- No serif anywhere. No Inter (taste-skill ban). No text gradients.

## 4. Layout

- **Grid, not flex math.** CSS Grid for page structure; flex only for rows of items.
- **Containers.** Public pages `max-width: 720px` centered column for forms and chat; staff screens `max-width: 1400px`.
- **Spacing scale.** 4, 8, 12, 16, 24, 32, 48, 64 px. Nothing in between.
- **Radius.** 6 px on inputs and buttons, 10 px on panels, 999 px on badges. Industrial means tight corners; no 24 px+ "soft" cards.
- **Cards only for elevation.** Lists, queues and tables use `divide-y` lines and whitespace, not a box per row. A panel earns a border only when it groups a separate task (a summary to confirm, a filter sheet).
- **Left-aligned.** Headings and content start at the left edge. Center only empty states and single-message screens (sign-in sent, thank you).
- **Phone first.** Every screen works at 360 px with a 16 px gutter and no horizontal scroll. Multi-column layouts fall to one column below 768 px. Use `min-height: 100dvh`, never `100vh`.
- **Touch targets** at least 44 x 44 px, with 8 px between neighbours (Apple HIG). Field techs may wear gloves.
- **Sticky primary action** on phones: when a form is longer than one screen, keep its submit button in a bottom bar on a solid `--surface` with a top `--line` border.

## 5. Components

- **Header.** Solid `--ink` or `--charcoal` bar, white wordmark left, nav right; the active item has a 3 px red underline. No translucent or blurred bars.
- **Primary button.** `--signal` fill, white text, 600 weight, 44 px tall, 6 px radius. Hover `--signal-press`. Pressed `transform: translateY(1px)`.
- **Secondary button.** Transparent, 1.5 px `--charcoal` border, `--ink` text. Tertiary is a text button in `--charcoal`.
- **Destructive action** (remove staff, discard). Text button in `--signal-text` plus a confirm step that names what will happen. Never a second solid red button beside the primary.
- **Urgency badge.** High: `--signal-tint` background, `--signal-text` text, warning icon, "High". Medium: amber tint, amber text, clock icon. Low: `--line` background, `--charcoal` text. Uppercase, 0.75 rem, 600.
- **Status badge.** New (charcoal outline), In progress (amber), Resolved (green with check icon), Closed (slate). Same shape as urgency badges, different word always visible.
- **Section label.** Mono or condensed uppercase, 0.75 rem, `--charcoal`, with a 24 x 3 px red bar above it. Use it once or twice per page, not on every block.
- **Forms.** Label above input, helper text below label, error below input in `--signal-text` with an icon. Inputs 44 px tall, 1.5 px `--slate` border, `--surface` fill, 3 px red focus ring with 2 px offset.
- **Queue rows.** Mono reference, title, app, urgency badge, age ("2 h", "3 d") right-aligned in mono, and the pick-up button. Highest urgency first, then oldest.
- **Icons.** One set only (Phosphor or Lucide), stroke 1.75 to 2, sized to the text they sit beside. No emoji anywhere: code, copy or alt text.

## 6. States

Build every state, not only the happy path (taste-skill rule 5):
- **Loading.** Skeleton rows the same size as the real ones. A spinner only inside a button that is working, with the button label kept.
- **Empty.** One line saying what will appear here and how it gets there, and the action if there is one. ("No tickets in the queue. New feedback lands here.")
- **Error.** Inline, next to the thing that failed, in plain words, with a retry. Never a toast alone for a failed save.
- **Offline or service down.** Say what still works. For a chat agent, switch to the backup form and keep what the user typed.
- **Success.** Confirm with the concrete result ("Your reference is FD-0042"), not "Success!".

## 7. Motion

- Animate `opacity` and `transform` only. Entrances use the spring curve `--ease-spring` (about 400 ms, one soft overshoot); hover, press and state changes stay 150 to 320 ms.
- Allowed: spring entrances for messages, cards and steps; a 60 ms stagger on short lists (`--i`); press scale (0.98) on buttons and cards; a 2 px lift on hover for tappable rows (`lift`); sheet and menu open; a badge changing state; nothing loops.
- Not allowed: other looping animations, parallax, scroll hijack, magnetic buttons, particle effects, pulsing red dots. A pulsing red element in a fire services app reads as an alarm.
- `prefers-reduced-motion: reduce`: no transform motion, Sig's writing mark holds still, opacity fades at 120 ms.
- No motion library. CSS easing curves and keyframes cover this intensity.

## 8. Quiet by default

The owner's rule (2026-10-21): no component is noisy. Remove what doesn't earn its place before adding anything. No text repeated on a screen or between sign-in and landing; red for the one key action and the hero band, not decorative icons; muted secondary text; pills only for status; show information when it helps (a warning near a limit, not a constant meter); motion only when it explains something.

## 9. Copy

- Plain words, short sentences, active voice. Say what happened and what to do next.
- Name things the way the team does: "ticket", "queue", "pick up", "hand back", "reference".
- Never: "Elevate", "Seamless", "Unleash", "Empower", "Next-gen", "Revolutionize", exclamation marks in system messages.
- Realistic sample data: real-sounding app names and people, irregular numbers (FD-0137, 3 h 12 m), never "John Doe", "Acme" or 99.9 %.
- Dates and times in the user's locale; relative ages ("2 h ago") in lists, exact time on hover and on detail pages.

## 10. Accessibility (non-negotiable)

- WCAG 2.2 AA in both themes. Visible focus ring on every interactive element.
- Everything works with keyboard only, in a logical order. Dialogs trap focus and return it on close.
- Text resizes to 200 % without loss; layouts use rem and wrap.
- Status changes announced with `aria-live="polite"` (new message from the agent, ticket picked up).
- Images and icons that carry meaning have labels; decorative ones are hidden from screen readers.

## 11. Stack defaults

Unless the project says otherwise: React + Vite + TypeScript + Tailwind, tokens as CSS variables mapped into the Tailwind theme. Check `package.json` before importing any library and give the install command if it is missing. Check the Tailwind version before using v4 syntax.

## 12. Pre-flight check

Before handing over a screen, check:
- [ ] Red covers 10 % of the screen or less, and there is one solid red button at most.
- [ ] Every status and urgency shows a word and an icon, not only a color.
- [ ] Headings are condensed uppercase; body, labels and buttons are not.
- [ ] Works at 360 px with no horizontal scroll; touch targets are 44 px or more.
- [ ] Loading, empty, error and success states exist.
- [ ] Contrast passes AA in light and dark; focus ring visible on red buttons.
- [ ] No gradients, glows, emoji, pulsing elements, Inter, or filler words.
- [ ] No hard-coded hex values in components; everything reads the tokens.
