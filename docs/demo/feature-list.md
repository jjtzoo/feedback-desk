# Feedback: every feature to show in the demo

★ = Chris asked for it on 28 Oct (D91 to D99) · ✦ = new since his review (D100 to D106)
F numbers are the brief's requirements (`docs/requirements.md`). The short route for Chris is in `chris-walkthrough.md`; this is the full list to pick from.

## 1. Staff (sign in as Liam, Mario or Aisha)

| ✓ | Feature | How to show it | Ref |
|---|---|---|---|
| [ ] | Sign-in and roles | Local sign-in picker; staff land on the chat, Digital Staff and Admins on the console | F1 |
| [ ] | Landing page | Red band "What can we help you with?", Give feedback, the four starting points, tool picker, recent feedback | F3 |
| [ ] | Guide tour | Guide (top right): a step with something to click pulses it, dims the rest, and waits for you | F1 |
| [ ] | Chat opens with app cards ★ | Usual tools first, then the catalogue, then Something else; pick one and Sig never asks which tool | D99 |
| [ ] | Sig asks little | At most 3 questions; impact read from what you said ("blank screen" is urgent) | F3, D69 |
| [ ] | Screenshots ★ | Paste with Ctrl+V, drag, paperclip, Take a photo on a phone; thumbnails in the chat, on the card and the tracker; "Check it doesn't show passwords or card numbers" | D95, F4 |
| [ ] | Context captured | The page and browser they came from arrive with the item, no typing | F5 |
| [ ] | Confirm card | Nothing is saved until Confirm; then "Sent. Your reference is FB-…" and who has it | F3, D12 |
| [ ] | Duplicate check | Raise the same problem twice: "Someone may have raised this already", no names shown, Add my comment there instead | F8 |
| [ ] | Backup form | When Sig is unavailable, a plain form takes over with "Sig isn't available right now." | F10 |
| [ ] | Allowance meter | Under the chat box once half the daily allowance is used; a heads-up from Sig at 80 % | D36 |
| [ ] | My feedback | Own items and followed items, Open and Closed, with plain status and "updated … ago" | F9 |
| [ ] | Tracker | Parcel-style: five-stage stepper, reference, Expected by | F13 |
| [ ] | One Conversation ✦ | Messages with the owner and approver, and Sig's plain words on each move, oldest first; "In this conversation" names each person once | D105, D106 |
| [ ] | Is it fixed? ★ | On a Resolved item: Yes, close it, or I still have an issue (with a screenshot) which reopens it; reminder after 3 days, closes itself after 7 | D92 |
| [ ] | Other people's items ★ | Open someone else's link: general information only, no names, files or messages; This affects me too | D97 |
| [ ] | Notifications | The bell count rises within seconds without a refresh; a click opens where the news is | F14, D81 |
| [ ] | Fixes and updates | Each Friday's release per tool, grouped Fixed, Improved, New, with tool chips | F17 |

## 2. Digital Staff (sign in as Darlene or Mario)

| ✓ | Feature | How to show it | Ref |
|---|---|---|---|
| [ ] | Board, list and cards | Work page, Assigned to me; columns by role; "N overdue" in a column header | F11 |
| [ ] | Developer brief | Brief tab: recommendation, problem, steps, expected and actual, the chat folded at the foot | F7 |
| [ ] | Auto-assigned | "Auto-assigned to Darlene · owner of RAKE Agent": code routes, the model never picks a person | F6, D2 |
| [ ] | Classification with confidence | Project, work type, category and priority with the model's %; changes held until Save ✦ | F6, D104 |
| [ ] | Status button ★ | One Status button listing only the allowed moves; the board drag and row menu use the same list | D91 |
| [ ] | Approval instructions pinned ★ | "From Chris, at approval" at the top of the item | D93 |
| [ ] | Internal by default ★ | The composer starts as Internal note; Message the reporter is a deliberate switch with its own colour; images on replies | D96, D95 |
| [ ] | Due date moves ★ | Moving Due after approval asks why (internal) and tells the approver | D94 |
| [ ] | Hand over, take over, assign to me | Take over names whose it is and their latest step | D53 |
| [ ] | New since you looked | "New reply" on the list and card, New in the panel | |
| [ ] | Merge duplicates | Merge into it: the tracker says "Duplicate of FB-…", the reporter follows the original | F8 |
| [ ] | Project channels | One per project, "Staff never see these", #FB-0001 chips (see "Avoid" below) | F15 |

## 3. Admins (sign in as Chris or Marc)

| ✓ | Feature | How to show it | Ref |
|---|---|---|---|
| [ ] | Approvals ★ | Approve with instructions, priority and Due; decline with a reason; nothing starts unapproved | F12, D93, D94 |
| [ ] | Admin page | Projects (15), Digital Staff, Routing rules; read-only for non-Admins | F2 |
| [ ] | Friday releases | Draft this week now: one draft per project with activity; owners review and publish | F17 |
| [ ] | Dashboard | Open items, waiting for approval, time to first response, reassignment rate, 8-week trend with Show table | F16 |
| [ ] | AI usage | Spend per person and in total, against the limits | D36 |

## 4. Say, don't click (why it's safe)

- Roles are checked on the server on every call; staff only ever see their own items in full (F1, D1).
- The model classifies; code picks the person (D2). Nothing is saved without the confirm card (D12).
- Passwords, card numbers and TFNs are masked before anything is stored (try one in a chat).
- Files: type, size and count checked twice; macro files refused (F4).
- If Gemini fails or the allowance runs out, the backup form takes over (F10, D36).
- Works at phone width and by keyboard alone; respects reduced motion.
- Tested: 276 browser tests of the manual checklist, run in 10 to 16 minutes; the routing gate and conversation checks pass on Gemini (93 of 98 conversations on the last record).
- Ready to deploy: Cloud Run scripts, CI and the worker job are written, waiting for Google Cloud access (the asks).

## 5. Avoid in the demo (known gaps or pending decisions)

- Channels and the dashboard's bar lists: the 28 Oct notes propose removing Channels (D40) and trimming the dashboard; not decided.
- The developer brief can't be edited yet.
- No notifications page (the bell only); the list view isn't sortable; no inline preview for PDF, Word or Excel.
- A published release isn't linked from the tracker.
- Email: built, but switched off locally until ask 4 or 10 (Gmail or ZeptoMail).
- Google sign-in: built, but the demo uses the local picker until ask 2.
