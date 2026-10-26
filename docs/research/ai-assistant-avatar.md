# AI assistant avatars: benchmark and evidence, tested against Sig

Research for spec D37 (Sig, the chat assistant) and D17 (the avatar idle loop). Researched 2026-10-26 from vendor documentation, design-studio case studies, peer-reviewed studies and regulator guidance. Part 1 benchmarks how top products present their AI assistant; part 2 adds the research and the rules; part 3 tests Sig against both, for Marc's review of D37.

Each claim carries a confidence mark:

- **Official**: the vendor's, studio's or regulator's own documentation or page.
- **Research**: a peer-reviewed study or meta-analysis (abstract or full text read).
- **Secondhand**: press, review site or consultancy. Treat as directional.
- **Unconfirmed**: not found, or sources conflict.

Vendor features and plan details change often. Where only an abstract was read, it says so.

## Summary

1. **No top product uses a human face.** They split three ways: an abstract mark (Gemini's sparkle), an expressive non-human character (Microsoft's Mico, Notion's face) or a full cartoon character (Duolingo's Lily, a consumer learning app). Support and employee tools (Intercom, Zendesk, Featurebase, Moveworks) ship a mark and a name, and expect customers to swap in their own mascot or logo. Sig, a non-human mascot with a screen face, sits in the expressive-character group, which is where the current leaders are heading.
2. **The character's job is to show state.** Notion, Lily and Mico all animate listening, thinking and error so a wait feels intentional. Sig already has four states (ready, writing, sent, offline), which matches the pattern.
3. **Disclosure is done in words, not by the picture.** Intercom puts "Fin AI Agent" under every message; Zendesk says the name must make it clear it isn't a human; PatternFly and NN/g say AI icons need text. Sig's `AI` tag beside the name follows the leaders. The greeting should say it too.
4. **The evidence favours a light touch.** Human-like cues have a small-to-moderate positive effect on how people respond (meta-analysis g = 0.36), with little support for an uncanny-valley penalty. Nothing found compares flat with 3D.
5. **One gap: the idle loop.** WCAG 2.2.2 (Level A) needs a way to pause or stop motion that starts on its own, lasts more than 5 seconds and runs beside other content. Sig's 5-second swell loops forever, and the brief relies only on `prefers-reduced-motion`. Recommended fix: stop the swell after one cycle (see R3).

## Part 1: Benchmark of top products

### At a glance

| Product | What the assistant looks like | Name and AI label | States and motion | Can it be hidden? | Confidence |
| --- | --- | --- | --- | --- | --- |
| Microsoft Copilot: Mico | A floating, emoji-like blob or flame with a face; changes colour, spins, wears glasses in study mode | Copilot; Mico is the face | Expressions follow the conversation ("when you talk about something sad, you can see Mico's face change") | Yes, easy to turn off; on by default in voice mode | Secondhand (TechCrunch, Fast Company, quoting Microsoft) |
| Notion AI | Hand-drawn face only: eyes, brows and a nose. Made by BUCK from Notion's art director's design | Notion AI | Thinking: brows wave. Error: the face briefly falls apart. Built on a Rive state machine to stay small and fast | Unconfirmed | Official (BUCK case study) |
| Duolingo: Lily (video call) | Full cartoon character, head and body | Lily, an established character | Listening: leans in, furrows brows. Waiting: tilts head, ponders, "makes the wait feel intentional". 8 head and 8 body moves combine into 64+ idle variations, so no visible loop. File under 1 MB | Not applicable (the character is the feature) | Official (Rive case study) |
| Intercom Fin | Default Fin mark, or a custom image; admins can set a name per brand | A "Fin AI Agent" label under every message (can be switched off); "Composed by AI" footer on emails, on by default | Not documented | Not applicable | Official (Intercom help) |
| Zendesk AI agents | Uploaded image, 50 × 50 px, under 100 KB; "simple, clear images … such as a logo or mascot" recommended | "Choose a name that makes it clear customers are not talking to a human" | Not documented | Not applicable | Official (Zendesk help, legacy article) |
| Featurebase: Fibi | Default Fibi icon; replace with your own | Rename to match your brand; AI label not documented | Not documented | Not applicable | Official (Featurebase help) |
| Moveworks (employee assistant) | Customer's own avatar; "most customers will build a custom Avatar, and select a custom name" | Custom name | Not documented | Not applicable | Official (Moveworks docs) |
| Slackbot (rebuilt as an AI agent) | The existing Slackbot mark; the rebuild is about voice, not looks | Slackbot | Personality through tone: "intelligent and helpful but also completely approachable and even a little bit fun"; matches the user's tone; explains what it searched and what it doesn't know | Not applicable | Official (Slack blog) |
| Gemini, Gmail, Zoom, Photoshop, Grammarly | Sparkle icons, no character | Product name | Not applicable | Not applicable | Secondhand (Fast Company) |

### Patterns across the benchmark

**P1. Three tiers of embodiment, none human.** Abstract marks for AI features inside other tools; an expressive non-human character for a named assistant people talk to; a full character only in consumer learning (Lily). Microsoft says it deliberately rejected both extremes: Jacob Andreou said giving AI no embodiment and creating "AI girlfriend" personas "don't really resonate with us". (Secondhand, Fast Company quoting Microsoft.)

**P2. Enterprise tools hand identity to the customer.** Intercom, Zendesk, Featurebase and Moveworks all ship a default and expect a company mascot or logo. Zendesk recommends exactly that. A company character such as Sig is the normal enterprise move. (Official.)

**P3. Animation serves state, not decoration.** Every character studied animates what the assistant is doing: listening, thinking, failing. Notion's error face and Lily's "pondering" during processing delays turn latency into something readable. (Official, case studies.)

**P4. State machines, not video.** Notion and Duolingo both use Rive state machines so expressions blend and files stay small (Lily under 1 MB). Lily mixes small moves so the idle never looks like a loop. (Official.)

**P5. The label carries the disclosure.** Intercom's per-message label, Zendesk's naming rule, and PatternFly's rule that AI icons always need text ("...with AI", "...by AI"). PatternFly also reserves the robot icon for chatbot avatars only. (Official.)

**P6. Make it easy to switch off, and never interrupt.** Mico's main difference from Clippy is that it is easy to turn off. Clippy's failures were unsolicited interruptions, being "optimised for first use", never learning the user, and a gaze that women in focus groups described as leering, raised before launch and ignored. (Secondhand: Fast Company; CIO New Zealand.)

## Part 2: Evidence and rules

### Does a human-like assistant help?

| Finding | Detail | Confidence |
| --- | --- | --- |
| Small-to-moderate positive effect | 142 papers, 199 datasets, N = 41,642: human-like social cues in text chat agents improve attitude, perception, affect, rapport, trust and behaviour, g = 0.36 [0.27, 0.44], varying by condition. Abstract only; the cue-by-cue results (avatar vs name vs language) are behind a paywall. | Research (Humanities & Social Sciences Communications, 2025) |
| Stronger effect on intention than on trust | 108 samples, N = 11,053 (robots, chatbots and other AI): anthropomorphism vs intention to use r = .35; vs trust r = .19; satisfaction was the strongest relational mediator. Effects were stronger for information-processing services, which describes a feedback chatbot. | Research (Journal of the Academy of Marketing Science, 2021) |
| Little uncanny-valley risk | Same meta-analysis: negative affect such as eeriness was not significantly related to anthropomorphism; "managers should not worry that an uncanny valley effect" will deter use. | Research |
| Avatar looks raise perceived empathy | A 160-person lab study: more human-like avatar visuals raised perceived empathy; the effect on experience ran through empathy and trust. The paper's coefficients are inconsistent between abstract and body, and it did not compare cartoon with realistic styles. | Research (Frontiers in Computer Science, 2025); weak |
| Disclosure has a cost in sales | 6,200-customer field experiment: disclosing the bot before a sales call cut purchases by about 80 %. Disclosing later, and customers' prior AI experience, reduced the penalty. This is outbound sales to strangers, not an internal tool, and disclosure is expected by guidance anyway (below). | Research (Marketing Science, 2019), abstract only |
| Gendered assistants reinforce bias | UNESCO's 2019 report found female-voiced, servile assistants reinforce gender stereotypes. The marketing meta-analysis found female-gendered robots had stronger effects, which is a reason for caution, not a recommendation. | Secondhand (press coverage of the UNESCO report); Research |
| Flat vs 3D | No study found that compares flat and 3D avatars for chat assistants. | Unconfirmed |

### Rules that apply

| Rule | What it says | Applies to REDADAIR? | Confidence |
| --- | --- | --- | --- |
| EU AI Act, Article 50(1), from 2 August 2026 | Systems that interact with people must tell them they are dealing with AI, at the latest at the first interaction, in a "clear and distinguishable" and accessible way. Tiny footer text doesn't count. Exception only when obvious to a reasonably well-informed person, and guidance warns against relying on it. | Not directly (Australian staff, internal tool), but it is the strictest benchmark and costs nothing to meet. | Official (AI Act explorer) |
| Australia: Guidance for AI Adoption (October 2025) | Voluntary. Supersedes the Voluntary AI Safety Standard. Six essential practices; practice 4 is "Share essential information" (transparency and explainability). | Yes, as voluntary guidance. Whether it keeps the old guardrail on telling users they are talking to AI was not confirmed. | Secondhand (White & Case) |
| WCAG 2.2.2 Pause, Stop, Hide (Level A) | Motion that starts automatically, lasts more than 5 seconds and runs beside other content needs a way to pause, stop or hide it, unless essential. No exemption for decorative motion. `prefers-reduced-motion` is not named as a substitute. | Yes. The spec requires AA, which includes all Level A criteria. | Official (W3C Understanding); the reading on `prefers-reduced-motion` is inference |
| NN/g on the sparkle icon | Users don't read sparkles as AI (0 of 107 in NN/g's study); 73 % read a star as save or favourite. Add text labels and tooltips. | Yes, if sparkles appear anywhere in the app. | Official (NN/g) |

## Part 3: Sig tested against the benchmark

| Check | Benchmark says | Sig today (brief of 2026-10-21) | Verdict |
| --- | --- | --- | --- |
| Human or not | No leader uses a human face; non-human expressive characters are the trend | A smart fire extinguisher with a screen face | Aligned |
| Company mascot | Enterprise tools expect the customer's own mascot | The group's own kit; can't be mistaken for a person or a brigade | Aligned |
| Gender | Avoid gendered, servile assistants | No gender | Aligned |
| States | Animate listening, thinking, error | Ready, writing, sent, offline, each also in words | Aligned. Gap: no distinct error face (Notion's "falls apart") for a failed reply, as opposed to offline |
| AI disclosure | A text label, at first interaction | `AI` tag beside the name; footer mentions Gemini; greeting is "G'day, I'm Sig." | Mostly aligned. The greeting doesn't say AI |
| Motion | State-driven, varied, light | One idle swell on Ready, 5 s, looping forever; off only under reduced motion | Gap against WCAG 2.2.2 |
| Can it be hidden | Mico: easy to turn off | Not offered | Acceptable: Sig lives only in the chat, never interrupts, and is small. Revisit if it appears elsewhere |
| Proactive interruptions | Clippy's main failure | None; Sig speaks only when the staff member opens the chat | Aligned |
| Flat vs 3D | Leaders lean 2D or soft, simple 3D (Mico); no evidence either way | Flat in product, 3D for large moments at 96 px and up | Reasonable; a design choice, not an evidence question |
| Co-design | Clippy's leering gaze was raised by women testers and ignored | The face has been reviewed by the design session only | Gap: no staff test yet |
| Sparkles | Ambiguous without text | Not used | Aligned |

## Recommendations

**R1. Keep Sig as the direction for D37.** The benchmark and the evidence both support a non-human, non-gendered company character with a clear name, an AI label and state-driven expressions. Nothing found argues for a human avatar or for no character.

**R2. Say "AI" in the first message, not only in the tag.** Change the greeting to "G'day, I'm Sig, Smoke Signal's AI assistant. Spotted something?" This meets the strictest benchmark (EU Article 50: at first interaction, in plain words) at no cost, and the sales-disclosure penalty doesn't apply to an internal feedback tool. Keep the `AI` tag.

**R3. Fix the idle loop for WCAG 2.2.2.** Options, in order of preference:
- (a) Play the swell once when Sig enters Ready (one 5 s cycle, or two shorter ones within 5 s), then rest. Simplest, and nothing to pause.
- (b) Keep the loop but add a visible "Pause animation" control. More UI for little gain.
Either way keep the reduced-motion rule. Update D17 ("one calm avatar idle loop") and brief rule 5 to match. If Lily-style variation is wanted later, do it as a Rive or CSS state machine with no loop longer than 5 s.

**R4. Add an error face.** A fifth state for "that reply didn't come through, try again", separate from offline (the backup form). Notion's falling-apart face is the model; keep it calm and paired with words, as rule 6 requires.

**R5. Test the face with staff before the pilot.** Five to eight staff across roles and genders, shown the four states at 32 px and the 3D figure: what is it, what is it doing, does anything feel off (gaze, expression). Clippy's 250 iterations failed on exactly this. Half a day; record results in `docs/testing/`.

**R6. Keep Sig inside the chat.** Don't add it to toasts, notifications or the console as an unprompted presence. If it ever appears outside the chat, add a way to switch it off (the Mico lesson).

**R7. Watch the measures, don't chase them.** The evidence says a friendly character helps satisfaction and willingness to use. After the pilot, compare chat completion and backup-form fallback with the pre-Sig baseline instead of assuming the lift.

## Questions for Marc (D37)

1. Approve Sig as the assistant, with R2 (AI in the greeting) and R3 (one-cycle swell)?
2. Add the error state (R4) in the same branch, or after the pilot?
3. Run the staff test (R5) before staging review, or in the pilot?

## Sources

Benchmark:

- [Microsoft's Mico is a 'Clippy' for the AI era (TechCrunch)](https://techcrunch.com/2025/10/23/microsofts-mico-is-a-clippy-for-the-ai-era)
- [Microsoft Mico, Copilot AI assistant (Fast Company)](https://www.fastcompany.com/91427839/microsoft-mico-copilot-ai-assistant)
- [Notion AI Assistant (BUCK)](https://buck.co/work/notion-ai)
- [Duolingo's AI-powered video call brings Lily to life (Rive)](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life)
- [Customize Fin AI Agent's identity and settings (Intercom)](https://www.intercom.com/help/en/articles/9794969-customize-fin-ai-agent-s-identity-and-settings)
- [Configuring an AI agent's name and avatar, legacy (Zendesk)](https://support.zendesk.com/hc/en-us/articles/6447066520986-Configuring-an-AI-agent-s-name-and-avatar-Legacy)
- [Set up and customize the Fibi AI agent (Featurebase)](https://help.featurebase.app/articles/6987939-set-up-and-customize-the-fibi-ai-agent)
- [Customizing your Teams Appstore bot (Moveworks)](https://docs.moveworks.com/ai-assistant/chat-platform-experiences/microsoft-teams/customizing-your-teams-appstore-bot)
- [How we rebuilt Slackbot (Slack)](https://slack.com/intl/en-au/blog/productivity/how-we-rebuilt-slackbot)
- [How the sparkles emoji took over AI (Fast Company)](https://fastcompanyme.com/co-design/how-the-sparkles-emoji-took-over-ai/)
- [AI iconography guidelines (PatternFly)](https://www.patternfly.org/ai/guidelines/iconography)
- [What went wrong with Clippy (CIO New Zealand)](https://www2.cio.co.nz/article/662045/what-went-wrong-clippy-virtual-assistant-pioneer-people-loved-hate/)

Research and rules:

- [The effects of human-like social cues on social responses towards text-based conversational agents: a meta-analysis (2025)](https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05618-w.html)
- [Understanding anthropomorphism in service provision: a meta-analysis (JAMS, 2021)](https://link.springer.com/article/10.1007/s11747-020-00762-y)
- [Effect of anthropomorphism and perceived intelligence in chatbot avatars (Frontiers, 2025)](https://frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2025.1531976/full)
- [Machines vs. humans: the impact of AI chatbot disclosure on customer purchases (Marketing Science, 2019)](https://ideas.repec.org/a/inm/ormksc/v38y2019i6p937-947.html)
- [Siri and Alexa reinforce gender bias, says UNESCO report (FutureScot)](https://futurescot.com/siri-and-alexa-reinforce-gender-bias-says-unesco-report/)
- [The EU AI Act's transparency rules: a practical guide to Article 50](https://artificialintelligenceact.eu/?p=6131)
- [Australia launches new AI guidance (White & Case)](https://www.whitecase.com/insight-alert/australia-launches-new-ai-guidance)
- [Understanding Success Criterion 2.2.2: Pause, Stop, Hide (W3C)](https://www.w3.org/WAI/WCAG20/Understanding/pause-stop-hide)
- [The AI sparkles icon problem (NN/g)](https://nngroup.com/articles/ai-sparkles-icon-problem/)

Internal: `docs/design/smoke-signal-integration.md`, spec v3 D17 and D37.
