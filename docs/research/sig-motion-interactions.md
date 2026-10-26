# Sig in motion: interaction benchmark and catalogue

Follow-on to `ai-assistant-avatar.md`. That doc settled what Sig is; this one covers how Sig moves and reacts on the page: to typing, buttons, files, duplicates, sending and errors, plus a few playful extras. Researched 2026-10-26 from product case studies, animation-studio write-ups, design guidance and W3C. Checked against the current code: `web/src/components/chat/sig-avatar.tsx` (flat inline SVG, four faces), `chat-panel.tsx` and the motion utilities in `globals.css` (`animate-fade-up`, `lift`, `animate-breathe`).

> **Outcome (2026-10-26):** option A was built (pilot reactions #1 to 11) and removed the same day. The product owner found the reactions decorative rather than useful, so Sig became a functional mark that moves only while it writes (spec D49). The research below is kept as the record.

Confidence marks as in the first doc: **Official** (the maker's own page), **Research**, **Secondhand**, **Unconfirmed**.

## Summary

1. **The best mascots react to what you do, not to time passing.** Rive's login bear follows the text as you type, covers its eyes on the password field, cheers on success and looks shocked on failure. Duolingo's characters idle with small blinks and nods, then land on a reaction when an answer is checked. Mailchimp's chimp sweats over the send button, then high-fives you. The pattern: **input → reaction → back to rest.**
2. **Make rare moments big and common moments small.** Animate a one-off like sending more than you animate typing. A reaction you see 30 times a session should be tiny or nothing.
3. **Sig can be goofy in the chat and should stay still in the console.** Staff open the chat a few times a month, so delight fits there. Digital Staff live in the console all day, so it gets no Sig motion.
4. **Accessibility shapes it, but doesn't kill it.** With reduced motion on, Sig still changes face but doesn't move (WCAG counts colour and opacity changes as not motion). Nothing loops past 5 seconds, nothing flashes, and every state keeps its words.
5. **One brand trap.** A "spray the hose when sent" gag would literally put out the staff member's feedback, which brief rule 7 bans. The send moment should be **Sig sending up a puff**: the smoke signal.
6. **Build it with what's there.** Add a short-lived `reaction` prop on `SigAvatar` with CSS keyframes, with no new dependency. Rive, which Duolingo, Notion and Intercom use, is the step up if the 3D Sig is commissioned with real animation later.

## Part 1: Benchmark

| Product | What reacts | To what | How it rests | Confidence |
| --- | --- | --- | --- | --- |
| Rive login bear ("Teddy") | Eyes follow the typed text left to right; hands cover the eyes on the password field; happy pose on success; shock and a head shake on failure | Field focus, typing position, submit result | Back to idle when typing stops; eye moves 200 ms, return from success 1,000 ms | Official (Rive blog) |
| Duolingo characters | Head nods, blinks, eyebrow moves at idle; a final pose showing right or wrong; lip sync when a word is tapped | Answer checked, word tapped | Speech stops early if the learner moves on: the character never holds you up | Official (Duolingo blog) |
| Duolingo streak milestones | Duo physically changes (a phoenix "power-up") | Milestone days only (a week, a month, 100 days, a year) | Shown on milestone days only, not daily | Official (Duolingo blog) |
| Duolingo Lily (video call) | Leans in while listening; tilts her head while the AI processes; 64+ idle combinations so it never visibly loops | Speaking, waiting for the model | Idle drawn from many small moves | Official (Rive case study) |
| Mailchimp | A sweaty chimp finger hovers over the red send button; high-five after sending | The riskiest moment in the product | One-off per send | Secondhand (Creative Review) |
| Notion AI | Brows wave while thinking; the face briefly falls apart on error | Thinking, error | Attentive without distracting | Official (BUCK) |
| Microsoft Mico | Changes colour and expression with the conversation; spins; wears glasses in study mode; **tap it several times and it turns into Clippy** | Conversation tone, taps | Can be switched off | Secondhand (TechCrunch, Fast Company) |
| Intercom | Product animations moved from Lottie to Rive: files about half the size (1.49 MB to 831 KB), and Safari performance fixed | Not applicable (marketing and product demos) | Not applicable | Official (Rive case study) |

### Rules of thumb from the benchmark and motion guidance

- **R-a. Every reaction answers an input.** None of the leaders animate on a timer to get attention (the Clippy failure). Idle motion is small and varied; reactions are tied to an event. (Official, above.)
- **R-b. Frequency sets the size.** "The more often users see an animation, the less it should animate." Skip animation on hover and keyboard actions used many times a day; keep UI motion under about 300 ms. (Secondhand: Emil Kowalski, design engineer, ex-Vercel.)
- **R-c. Never make people wait for the mascot.** Duolingo cuts speech short when the learner moves on. Reactions play beside the action and never in front of it. (Official.)
- **R-d. Put the joke where the feeling is.** Mailchimp's gag sits on pre-send nerves, not on a random button. (Secondhand.)
- **R-e. One hidden treat is enough.** Mico's tap-to-Clippy is the modern example of an Easter egg: optional, found by curiosity, harmless if never found. (Secondhand.)

## Part 2: Rules Sig must keep

| Rule | What it means for Sig | Level | Confidence |
| --- | --- | --- | --- |
| WCAG 2.2.2 Pause, Stop, Hide | Anything that starts on its own and runs past 5 s beside other content needs a pause control. Keep every loop under 5 s, or play once. (Today `animate-breathe` is `5s infinite`; see the first doc, R3.) | A (required) | Official (W3C) |
| WCAG 2.3.3 Animation from Interactions | Motion triggered by an interaction can be switched off. W3C's own technique is `prefers-reduced-motion`. Colour and opacity changes don't count as motion, so **face swaps are fine under reduced motion**. | AAA (good practice; the spec only requires AA) | Official (W3C) |
| WCAG 2.3.1 Three Flashes | No "glitch" effect may flash more than three times a second. | A (required) | Official (W3C, well established) |
| Brief rule 6 | Status never by the face alone: each reaction that means something also has words. | Project | Internal |
| Brief rule 7 | Sig puts out problems, never feedback. No spraying at the message, the send button or the reference. | Project | Internal |
| D17 | Spring entrances, press and lift, one calm idle; reduced motion honoured. | Project | Internal |
| Existing code | The reduced-motion block in `globals.css` already sets iteration count 1 and 120 ms duration for animations. New reactions inherit that; check it gives a face swap, not a jerk. | Project | Checked in code |

## Part 3: Interaction catalogue for Sig

Mapped to real moments in `chat-panel.tsx`. "Size" follows R-b: **S** is under 300 ms and barely there, **M** is 300 to 700 ms, **L** is up to 1.5 s and rare. All play once and return to the current state.

### Ship in the pilot

| # | Moment (code) | Sig does | Size | Words that go with it | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| 1 | Chat opens (`mode` becomes `chat`) | Pops up from below with a slight overshoot (the existing spring ease), then one blink | M | Greeting message | Appears; one blink as a face swap |
| 2 | Staff typing (textarea has focus and text) | Eyes glance down toward the text box and stay there while typing; back to centre 1 s after typing stops (the Teddy pattern, simplified to two positions) | S | None needed: decorative | Static "looking down" face |
| 3 | Send pressed (`busy` becomes true) | A small nod as if catching the message, then the existing Writing face | S | "Sig is writing…" (exists) | Face swap only |
| 4 | Files dragged over the chat (drop zone active) | Eyes widen, mouth makes an "o": something's coming | S | Existing drop-zone text | Face swap |
| 5 | Possible duplicate found (`duplicates.length > 0`) | Head tilt with one raised brow: "huh, seen this" | M | Existing duplicate copy ("Someone may have reported this") | Face swap |
| 6 | Confirm card shown (`card` set) | Leans in slightly and holds; the Mailchimp moment, but calm: no sweat | S | Card text | None |
| 7 | **Sent** (`mode` becomes `done`) | Sig hops once and a small Puff (the logo shape) rises from the nozzle and fades upward. **The smoke signal is sent.** Done view headline lands as the puff fades | L | "Sent. Your reference is FB-…" (exists) | Sent face; Puff appears and fades by opacity only |
| 8 | +1 added to an existing item (`plusOne`) | Small double hop: "you're not alone" | M | "Added to FB-…" (exists) | Face swap |
| 9 | A reply fails (stream error) | Screen face scrambles into static for 300 ms, then a worried face. One change, **no flashing** | M | "That didn't come through. Try again." | Worried face only |
| 10 | Offline (`mode` becomes `fallback`) | Slumps down 2 px and the screen dims (the existing grey Offline state) | M | "Sig isn't available right now" (exists) | Face swap |
| 11 | Sig clicked or tapped | A wink | S | None: decorative | Face swap |

### Later, if the pilot goes well

| # | Moment | Sig does | Why wait |
| --- | --- | --- | --- |
| 12 | Easter egg: tap Sig 5 times quickly | Sig does a little spin and puffs out a ring of smoke. Never sprays anything | Fun, harmless, but a pilot should test the basics first |
| 13 | Landing page: pointer near the Give feedback button | 3D Sig's eyes glance at the button. Desktop only, landing only, stops after the first click | Eye-follow can feel watchful (Clippy's "leering" gaze); test with staff first (first doc, R5) |
| 14 | Praise feedback (if the classifier tags it as praise) | Thumbs-up with the hose arm | Depends on a reliable praise tag; a wrong cheer on a complaint would sting |
| 15 | Long streak or seasonal moments (Christmas hat in December) | Accessory swap on the avatar | Low cost; decide on tone with Marc |

### Don't

- **No reactions to what people write.** Mico reacts to sadness; Sig shouldn't look pleased or upset about a complaint. It reacts to **actions**, not content (#14 is the only exception, and it waits).
- **No hose spray at feedback, the send button or the reference** (rule 7).
- **No nudges when idle.** If the staff member stops typing for a minute, Sig blinks; it never pops a message (R-a, Clippy).
- **No Sig motion in the console, toasts or notifications.** Frequency rule, and D37's flat-in-product rule.
- **No reaction on every keystroke or hover.** #2 is a held pose, not a per-key twitch.
- **No reaction longer than 1.5 s, and none that delays the next step** (R-c).

## Part 4: How to build it

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| **A. CSS and SVG (recommended for the pilot)** | Add `reaction?: "pop" \| "look-down" \| "nod" \| "wow" \| "tilt" \| "lean" \| "hop-puff" \| "double-hop" \| "glitch" \| "slump" \| "wink"` to `SigAvatar`. Each is a keyframe of 600 ms or less with `iteration-count: 1`, plus a face variant in `SigFace`. A small `useSigReaction()` hook in `chat-panel.tsx` sets the reaction on the events above and clears it on `animationend`. | No new dependency (CLAUDE.md). Fits the existing `animate-fade-up`, `lift` and token rules. Server-rendered, tiny, and reduced motion is already handled globally | Hand-tuned; blending between states is basic |
| B. Rive (`@rive-app/canvas-lite`) | An animator builds a state machine (inputs such as `isTyping`, `trigSent`, `trigFail`), the way Duolingo, Notion and Intercom do | Smooth blends, richer character, the designer owns motion | A new dependency and a WASM download; needs an animator; canvas art needs its own accessibility label. Best paired with the commissioned 3D Sig after D37 |

Implementation notes for option A:

- Reactions are **transient**: the four base states (ready, writing, sent, offline) stay as today, and a reaction plays on top.
- Keep transforms on the inner `<svg>` (as `animate-breathe` does) so layout never shifts.
- Use the existing `--ease-spring` token for pops and hops.
- The Puff in #7 reuses the `BrandMark` path, rendered as an absolutely positioned SVG that translates up 24 px and fades over about 1.2 s.
- Add one e2e check: reduced motion on, send a message, assert the face changes and nothing has a running animation longer than 5 s.
- Update the brief (`smoke-signal-integration.md` rule 5) and D17 in the same change, per CLAUDE.md.

## Questions for Marc

1. How goofy? The pilot set (#1–11) is playful but polite. Add the Easter egg (#12) now or later?
2. OK with the send moment being Sig puffing up a smoke signal (#7), rather than any hose gag?
3. CSS now and Rive later with the commissioned 3D, or go straight to Rive?

## Sources

- [Animated login screen design (Rive)](https://rive.app/blog/animated-login-screen-design)
- [How Duolingo animates world characters, visemes (Duolingo blog)](https://blog.duolingo.com/world-character-visemes)
- [Streak milestone design and animation (Duolingo blog)](https://blog.duolingo.com/streak-milestone-design-animation/)
- [Duolingo's AI-powered video call brings Lily to life (Rive)](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life)
- [From Serial to singing shrimp: Mailchimp on playfulness (Creative Review)](https://www.creativereview.co.uk/mailchimp-on-playfulness/)
- [Notion AI Assistant (BUCK)](https://buck.co/work/notion-ai)
- [Microsoft's Mico is a 'Clippy' for the AI era (TechCrunch)](https://techcrunch.com/2025/10/23/microsofts-mico-is-a-clippy-for-the-ai-era)
- [Microsoft Mico, Copilot AI assistant (Fast Company)](https://www.fastcompany.com/91427839/microsoft-mico-copilot-ai-assistant)
- [Intercom's product animation evolution, embracing Rive (Rive)](https://rive.app/blog/intercom-s-product-animation-evolution-embracing-rive)
- [You don't need animations (Emil Kowalski)](https://emilkowal.ski/ui/you-dont-need-animations)
- [Rive web runtime FAQ](https://rive.app/docs/runtimes/web/faq)
- [Understanding SC 2.3.3 Animation from Interactions (W3C)](https://w3.org/WAI/WCAG21/Understanding/animation-from-interactions)
- [Understanding SC 2.2.2 Pause, Stop, Hide (W3C)](https://www.w3.org/WAI/WCAG20/Understanding/pause-stop-hide)
- [What went wrong with Clippy (CIO New Zealand)](https://www2.cio.co.nz/article/662045/what-went-wrong-clippy-virtual-assistant-pioneer-people-loved-hate/)

Internal: `docs/research/ai-assistant-avatar.md`, `docs/design/smoke-signal-integration.md`, spec v3 D17 and D37.
