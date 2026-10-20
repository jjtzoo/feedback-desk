# Feedback Desk: MVP build spec

Lets website visitors leave feedback in a short chat and lets staff sort, assign and answer it from one dashboard.

Written 2026-10-17 by Scrum Planner with Claude Haiku 5.5 (cost US$0.0118). Team of 2, MVP in 2 weeks: 2 one-week sprints, 26 story points per sprint.

## How to build from this file

This file is the whole brief. If you are an AI coding agent or a developer starting the build:

1. Read the file to the end before writing code. Build only what is here; ask the product owner before adding, dropping or reordering anything, and record each new decision in the Decisions table (D7 onwards).
2. Set up the stack in "Stack and architecture". Put the CSS variables from "UI package" into the global stylesheet before building any screen, then build the components in "Components", then the screens.
3. The visual direction is already chosen: **Clear Sage**. Before building screens, show the product owner a clickable mockup of the first two screens in this direction and build after they approve it.
4. Work sprint by sprint, story by story, in the order listed. A story is done only when every "Done when" line passes by using the app, and the Definition of Done holds.
5. A story not done by the end of its sprint moves to the next sprint. Never ship it half tested.
6. At the end of each sprint, run the demo described for it and add a short outcome note under that sprint: what was shown, what moved, what was learned.
7. Before calling any screen finished, go through the "Design checklist".

## Product

**Problem.** Public feedback arrives by scattered emails and contact forms, so urgent issues sit unseen. Staff have no simple way to sort topics, assign owners or reply in one place.

**MVP goal.** The MVP must prove that a short chat brings more useful feedback than a form, and that staff can triage and reply to it within one working day.

**The idea as given.**

> A feedback chatbot for our public website. Visitors leave feedback in a short chat, the AI tags it by topic and urgency, and staff see it in a dashboard where they can filter, assign and reply.

### Users and roles

| Role | Most frequent task |
| --- | --- |
| Visitor | Leaves a short piece of feedback in the chat on the public website. |
| Staff member | Filters new feedback, assigns it and replies by email. |
| Admin | Invites staff members and corrects AI tags when they are wrong. |

### Product owner's answers

- Who are the first visitors who will leave feedback? **Anyone, with optional email**
- How should staff sign in to the dashboard? **Email magic link**
- How should a staff reply reach the visitor? **Email reply only**
- How should the AI tags be applied? **Apply automatically**
- Which visual style should the dashboard and widget use? **Light, flat, solid surfaces**

## MVP scope

| ID | Feature | Priority | What it does | Accepted when |
| --- | --- | --- | --- | --- |
| F1 | Feedback chat widget | Must | A chat widget on the public site asks a few short questions and takes an optional email. | A visitor can submit feedback without signing in.; The visitor can skip the email field and still submit.; The widget loads on any page from one script tag. |
| F2 | Automatic AI tagging | Must | After submit, the AI sets one topic and one urgency on each feedback item. | Each submitted item has one topic and one urgency within 10 seconds.; Urgency is always low, medium or high.; If the AI call fails, the item saves as topic Other and urgency medium. |
| F3 | Staff sign-in by magic link | Must | Staff sign in with a one-time link sent to their work email. | A staff email receives a link that expires in 15 minutes.; An email that is not invited gets no link and no account.; A used link cannot sign in a second time. |
| F4 | Feedback list with filters | Must | The dashboard lists feedback and filters it by topic, urgency, status and assignee. | Filters combine, so topic and urgency apply together.; The list shows newest first, 50 items per page.; The item count matches the filtered rows. |
| F5 | Assign feedback | Must | Staff assign an item to a staff member or leave it unassigned. | An assignment shows in the list at once.; The assignee name appears on the item page.; Removing the assignee returns the item to unassigned. |
| F6 | Email reply to visitor | Must | Staff write a reply that is emailed to the visitor and saved in the thread. | Reply is offered only when the visitor left an email.; A sent reply shows the sender and time in the thread.; A failed send shows a failed status on that reply. |
| F7 | Status tracking | Must | Each item moves through New, In progress and Resolved. | Changing status updates the list at once.; The status filter shows only items in that status.; A new item starts as New. |
| F8 | Admin invites staff | Must | An admin invites staff by email so they can sign in. | An invited email can complete sign-in.; A staff member who is removed cannot sign in.; Only admins see the invite page. |
| F9 | Staff corrects tags | Should | Staff change the AI topic or urgency on an item. | A changed tag saves and shows on the list.; A reload keeps the staff value and the AI does not overwrite it.; Each change records who made it and when. |
| F10 | Assignment email | Could | The assignee gets an email when an item is assigned to them. | The assignee receives one email per assignment.; The email links to the item.; No email is sent when the assignee is removed. |

### Out of scope for the MVP

| Item | Why not now |
| --- | --- |
| Live chat between staff and visitors | Owner chose email replies only. |
| Passwords or social login | Magic link is the only sign-in for the MVP. |
| Charts and reports | Filters are enough to triage at this volume. |
| Languages other than the site default | Keeps the AI prompt and widget text simple for launch. |
| File or screenshot uploads | Adds storage and abuse handling the MVP does not need. |

## Decisions

| ID | Decision | Why |
| --- | --- | --- |
| D1 | Staff replies go by email only. | Owner's answer. Keeps the chat and dashboard small. |
| D2 | AI tags apply automatically, and staff can correct them. | Owner's answer. Staff fix the rare wrong tag after the fact. |
| D3 | Staff sign in by magic link with no passwords. | Owner's answer. Removes password reset and storage work. |
| D4 | Visitors need no account, and email is optional. | A sign-in step would cut feedback volume. |
| D5 | Topics are one of six fixed values: Bug, Feature request, Pricing, Content, Support, Other. | A fixed list keeps filters and reports consistent. |
| D6 | Dashboard and widget use a light, flat style with solid surfaces. | Owner's choice. Solid fills make text contrast easy to check. |

## Stack and architecture

| Layer | Choice |
| --- | --- |
| Frontend | Next.js with TypeScript and Tailwind CSS |
| Backend | Next.js route handlers, Resend for email, OpenAI API for tagging |
| Database | PostgreSQL on Neon |
| Sign-in | Auth.js with email magic link |
| Hosting | Vercel for the app, Neon for the database |

These tools are mainstream and well documented, so AI coding agents build them reliably. One TypeScript codebase lets two people move fast.

### Data model

| Entity | Fields | Relations |
| --- | --- | --- |
| Staff | id:uuid, email:text, name:text, role:text, createdAt:timestamp | has many Feedback as assignee; has many Reply |
| Feedback | id:uuid, visitorEmail:text, topic:text, urgency:text, status:text, createdAt:timestamp, updatedAt:timestamp | belongs to Staff as assignee; has many ChatTurn; has many Reply; has many TagChange |
| ChatTurn | id:uuid, role:text, text:text, createdAt:timestamp | belongs to Feedback |
| Reply | id:uuid, body:text, deliveryStatus:text, createdAt:timestamp | belongs to Feedback; belongs to Staff |
| TagChange | id:uuid, field:text, value:text, createdAt:timestamp | belongs to Feedback; belongs to Staff |
| Session | id:uuid, staffId:uuid, expiresAt:timestamp | belongs to Staff |

### API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/chat/start` | Opens a feedback chat and returns a chat id. |
| POST | `/api/chat/message` | Saves a visitor message and returns the next question. |
| POST | `/api/chat/submit` | Saves the feedback and runs AI tagging. |
| GET | `/api/feedback` | Lists feedback with topic, urgency, status and assignee filters. |
| GET | `/api/feedback/[id]` | Returns one item with its chat turns, replies and tag history. |
| PATCH | `/api/feedback/[id]` | Changes status, assignee, topic or urgency. |
| POST | `/api/feedback/[id]/replies` | Sends an email reply to the visitor and saves it. |
| POST | `/api/auth/magic-link` | Emails a sign-in link to an invited staff address. |
| GET | `/api/auth/callback` | Checks the link and starts a staff session. |
| POST | `/api/auth/signout` | Ends the staff session. |
| POST | `/api/staff/invites` | Admin invites a staff member by email. |

## Backlog

### E1: Visitor feedback

**E1-1** (feature, 5 pts, Must, sprint 1, screen: Chat widget, feature F1)
As a Visitor, I want leave feedback in a short chat on any page, so that I can say what I think without filling in a form.
Done when:
- Widget opens from one script tag on a test page
- Visitor submits without signing in
- Visitor can skip the email field and still submit

### E2: Staff access

**E2-1** (feature, 5 pts, Must, sprint 1, screen: Sign-in, feature F3)
As a Staff member, I want sign in with a link sent to my work email, so that I need no password to remember.
Done when:
- Invited email gets a link that expires in 15 minutes
- Uninvited email gets no link and no account
- A used link fails on the second use

**E2-2** (feature, 3 pts, Must, sprint 1, screen: Invite staff, feature F8)
As a Admin, I want invite staff by email, so that they can sign in to the dashboard.
Done when:
- An invited email completes sign-in
- A removed staff member cannot sign in
- Only admins see the invite page

### E3: Triage

**E3-1** (feature, 5 pts, Must, sprint 1, feature F2)
As a Staff member, I want each item tagged with one topic and one urgency automatically, so that I can sort feedback without reading every item.
Done when:
- Submitted item gets one topic and one urgency within 10 seconds
- Urgency is always low, medium or high
- If the AI call fails, the item saves as Other and medium

**E3-2** (feature, 3 pts, Must, sprint 1, screen: Feedback list, feature F7)
As a Staff member, I want move each item through New, In progress and Resolved, so that the team sees what is handled.
Done when:
- A new item starts as New
- Status change updates the list at once
- Status filter shows only items in that status

**E3-3** (feature, 5 pts, Must, sprint 2, screen: Feedback list, feature F4)
As a Staff member, I want filter feedback by topic, urgency, status and assignee, so that I find urgent items fast.
Done when:
- Filters combine so all apply together
- List shows newest first, 50 items per page
- Item count matches the filtered rows

**E3-4** (feature, 3 pts, Must, sprint 2, screen: Item page, feature F5)
As a Staff member, I want one item page with its chat, replies, status and tags, so that I can act on an item in one place.
Done when:
- Page shows the full chat
- Page shows assignee name, status and tags
- Back link returns to the filtered list

**E3-5** (feature, 3 pts, Must, sprint 2, screen: Item page, feature F5)
As a Staff member, I want assign an item to a staff member or leave it unassigned, so that one person owns each item.
Done when:
- Assignment shows in the list at once
- Assignee name appears on the item page
- Removing the assignee returns the item to unassigned

**E3-6** (feature, 3 pts, Should, sprint 2, screen: Item page, feature F9)
As a Staff member, I want correct an AI topic or urgency, so that each item is sorted right.
Done when:
- A changed tag saves and shows on the list
- A reload keeps my value and the AI does not overwrite it
- Each change records who made it and when

### E4: Response

**E4-1** (feature, 5 pts, Must, sprint 2, screen: Item page, feature F6)
As a Staff member, I want email a reply to the visitor from the item page, so that the visitor hears back.
Done when:
- Reply box shows only when the visitor left an email
- Sent reply shows sender and time in the thread
- A failed send shows failed status on that reply

**E4-2** (feature, 2 pts, Could, sprint 2, feature F10)
As a Staff member, I want an email when an item is assigned to me, so that I see new work without checking the list.
Done when:
- The assignee gets one email per assignment
- The email links to the item
- No email is sent when the assignee is removed

### E5: Foundation and quality

**E5-1** (design, 3 pts, Must, sprint 1, screen: All screens, feature All)
As a Staff member, I want approve clickable mockups of the widget, sign-in, list and item page in the chosen look, so that screens are built once to an approved design.
Done when:
- Owner approves clickable mockups of all four screens
- Mockups use the tokens of the chosen direction
- Mockups show pressed, empty and error states

**E5-2** (tech, 2 pts, Must, sprint 1, feature All)
As a Staff member, I want the app deployed on Vercel with the Neon database and secrets set, so that both of us can test the same build.
Done when:
- Main branch deploys to a public preview URL
- Database migrations run on deploy
- Secrets are stored outside the code

**E5-3** (test, 5 pts, Must, sprint 2, feature All)
As a Staff member, I want end-to-end tests for the core flows, so that the Friday demo does not break.
Done when:
- Tests cover submit, sign-in, assign and reply
- Tests run on every merge
- A failing test blocks the merge

## Sprint plan

Each sprint runs Monday to Friday: planning on the first Monday, a 15-minute check-in every day, the demo and retrospective on the last Friday.

### Sprint 1

**Goal.** By Friday, a visitor can leave tagged feedback and invited staff can sign in and set status.
**Load.** 26 of 26 points.
**Demo.** Submit feedback in the widget, see its tags, sign in by magic link, change status.

| Story | Epic | Points | Summary |
| --- | --- | --- | --- |
| E5-1 | Foundation and quality | 3 | As a Staff member, I want approve clickable mockups of the widget, sign-in, list and item page in the chosen look |
| E5-2 | Foundation and quality | 2 | As a Staff member, I want the app deployed on Vercel with the Neon database and secrets set |
| E1-1 | Visitor feedback | 5 | As a Visitor, I want leave feedback in a short chat on any page |
| E3-1 | Triage | 5 | As a Staff member, I want each item tagged with one topic and one urgency automatically |
| E2-1 | Staff access | 5 | As a Staff member, I want sign in with a link sent to my work email |
| E3-2 | Triage | 3 | As a Staff member, I want move each item through New, In progress and Resolved |
| E2-2 | Staff access | 3 | As a Admin, I want invite staff by email |

**Outcome.** To be written at the sprint review.

### Sprint 2

**Goal.** By Friday, staff can filter, assign, correct tags and reply by email.
**Load.** 26 of 26 points.
**Demo.** Filter the list, assign an item, fix a tag, send an email reply.

| Story | Epic | Points | Summary |
| --- | --- | --- | --- |
| E3-3 | Triage | 5 | As a Staff member, I want filter feedback by topic, urgency, status and assignee |
| E3-4 | Triage | 3 | As a Staff member, I want one item page with its chat, replies, status and tags |
| E3-5 | Triage | 3 | As a Staff member, I want assign an item to a staff member or leave it unassigned |
| E4-1 | Response | 5 | As a Staff member, I want email a reply to the visitor from the item page |
| E3-6 | Triage | 3 | As a Staff member, I want correct an AI topic or urgency |
| E4-2 | Response | 2 | As a Staff member, I want an email when an item is assigned to me |
| E5-3 | Foundation and quality | 5 | As a Staff member, I want end-to-end tests for the core flows |

**Outcome.** To be written at the sprint review.

## UI package

Reading this as: feedback inbox for small public teams and website visitors, with a calm, plain language

Design rules: Apple design. Look: chosen by the planner. Motion feel: calm (no bounce). Dials: design variance 3/10, motion 2/10, density 5/10.

**Chosen direction: Clear Sage.** Fresh and steady, with a green accent that signals calm and progress. Default theme light, font IBM Plex Sans, pill corners. Not chosen: Quiet Slate, Warm Paper.

### Principles

- Calm first: one clear action per screen, plain words, and no decoration that does not help a task.
- Staff work fast from a list: keep rows dense, filters visible, and the next action one tap away.
- Visitors write in a short chat: ask one question at a time and never make them retype.
- Show what the AI did and let staff fix it in one step: tags are visible and editable on every item.

### Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | #F2F6F4 | #121A17 | App background behind all content |
| `surface` | #FFFFFF | #1A2420 | Cards, rows, sheets and the chat panel |
| `text` | #1D2A25 | #E6EFEB | Body text and headings, 4.5:1 or better on surface |
| `text-muted` | #55665E | #A3B5AC | Helper text, timestamps and labels, 4.5:1 or better |
| `border` | #D5E0DA | #2F3D37 | Dividers, input outlines and row separators |
| `accent` | #2E6B57 | #6FB59B | Primary buttons, selected filters and links |
| `on-accent` | #FFFFFF | #0F1914 | Text and icons on accent, 4.5:1 or better |
| `success` | #3B7A5E | #8CC9A8 | Resolved status and saved confirmations |
| `warning` | #8A5E14 | #E0B56A | Medium urgency and unassigned items needing attention |
| `danger` | #A94A41 | #E8948A | High urgency, failed sends and destructive actions |
| `focus` | #2E6B57 | #9FD8BE | 2 px focus ring on every interactive element |

### Type scale (IBM Plex Sans)

| Token | Size | Line height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| `display` | 40 px | 1.1 | 700 | -0.03 em |
| `title` | 28 px | 1.2 | 650 | -0.02 em |
| `heading` | 20 px | 1.3 | 600 | -0.01 em |
| `body` | 16 px | 1.5 | 400 | 0 em |
| `label` | 14 px | 1.4 | 500 | 0.01 em |
| `caption` | 12 px | 1.4 | 500 | 0.02 em |

### Spacing, shape, elevation, motion

Spacing scale: 4 px, 8 px, 12 px, 16 px, 24 px, 32 px, 48 px.

| Kind | Token | Value | Use |
| --- | --- | --- | --- |
| Radius | pill | 999 px | Buttons, chips, tags and status controls |
| Radius | input | 12 px | Text fields and the reply composer |
| Radius | card | 16 px | Cards, sheets, the widget panel and item rows |
| Elevation | e1 | 0 1px 2px rgba(29,42,37,0.06) | Rows and cards at rest |
| Elevation | e2 | 0 8px 24px rgba(29,42,37,0.12) | Menus and the widget panel |
| Elevation | e3 | 0 16px 40px rgba(29,42,37,0.18) | Modal sheets such as invite staff |
| Motion | press | Spring, damping 1.0, response 0.2s | Scale to 0.98 on pointer down, back to 1 on release |
| Motion | open | Spring, damping 1.0, response 0.35s | Menus and sheets grow from the control that opened them and shrink back to it on close |
| Motion | reduced | Fade, linear, 150ms, no scale or position change | Replaces press, open and all other motion when prefers-reduced-motion is set |

### CSS variables

Paste into the global stylesheet. Tokens map one to one to the tables above.

```css
:root {
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --color-bg: #F2F6F4;
  --color-surface: #FFFFFF;
  --color-text: #1D2A25;
  --color-text-muted: #55665E;
  --color-border: #D5E0DA;
  --color-accent: #2E6B57;
  --color-on-accent: #FFFFFF;
  --color-success: #3B7A5E;
  --color-warning: #8A5E14;
  --color-danger: #A94A41;
  --color-focus: #2E6B57;
  --text-display: 40px;
  --leading-display: 1.1;
  --weight-display: 700;
  --tracking-display: -0.03em;
  --text-title: 28px;
  --leading-title: 1.2;
  --weight-title: 650;
  --tracking-title: -0.02em;
  --text-heading: 20px;
  --leading-heading: 1.3;
  --weight-heading: 600;
  --tracking-heading: -0.01em;
  --text-body: 16px;
  --leading-body: 1.5;
  --weight-body: 400;
  --tracking-body: 0em;
  --text-label: 14px;
  --leading-label: 1.4;
  --weight-label: 500;
  --tracking-label: 0.01em;
  --text-caption: 12px;
  --leading-caption: 1.4;
  --weight-caption: 500;
  --tracking-caption: 0.02em;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --radius-pill: 999px;
  --radius-input: 12px;
  --radius-card: 16px;
  --shadow-e1: 0 1px 2px rgba(29,42,37,0.06);
  --shadow-e2: 0 8px 24px rgba(29,42,37,0.12);
  --shadow-e3: 0 16px 40px rgba(29,42,37,0.18);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #121A17;
    --color-surface: #1A2420;
    --color-text: #E6EFEB;
    --color-text-muted: #A3B5AC;
    --color-border: #2F3D37;
    --color-accent: #6FB59B;
    --color-on-accent: #0F1914;
    --color-success: #8CC9A8;
    --color-warning: #E0B56A;
    --color-danger: #E8948A;
    --color-focus: #9FD8BE;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 150ms !important; }
}
```

### Components

| Component | Variants | States | Rules |
| --- | --- | --- | --- |
| Button | primary, secondary, quiet, destructive | default, pressed, focus, disabled, loading | Minimum 44 px high. One primary button per screen. Loading shows a spinner and keeps the label width. |
| Text field | text, email, multiline | default, focus, filled, error, disabled | Label sits above the field. Error text appears below in danger. Minimum 44 px high. |
| Filter chip | topic, urgency, status, assignee | default, pressed, selected, focus, disabled | Opens a menu from the chip. Shows the selected value in the label, such as Urgency: High. |
| Feedback row | unread, read | default, pressed, focus, selected | Shows visitor message preview, topic tag, urgency tag, status and assignee. Minimum 56 px high. |
| Tag | topic, urgency high, urgency medium, urgency low | default, pressed, focus, disabled | Pill shape. Tapping opens a menu to correct the value. Shows an AI marker until staff change it. |
| Status control | New, In progress, Resolved | default, pressed, selected, focus, disabled | Segmented control in one row. Selected state uses accent fill with on-accent text. |
| Assignee menu | staff member, unassigned | default, pressed, focus, disabled | Menu grows from the control. Lists staff names and Unassigned at the top. |
| Chat bubble | visitor, system question, staff reply | default, focus, sending, failed | Maximum width 80 percent of the panel. Failed bubbles show a retry button in danger. |
| Reply composer | reply, internal note | default, focus, sending, disabled | Sends the reply by email and saves it in the thread. Sends only from the primary button. |
| Sheet | menu, modal task | default, pressed, focus, closing | Modal sheets dim the background. Menus do not dim it. Closing returns focus to the opener. |
| Toast | saved, failed | default, focus, dismissed | Appears at the bottom and disappears after 4 seconds. Failed toasts stay until dismissed. |
| Skeleton | row, card, thread | loading | Matches the final shape of the content. Pulses only when motion is allowed. |
| Empty state | no feedback, no results, no staff | default | One sentence of explanation and one button when an action helps. |

### Navigation

Left sidebar on desktop, top bar with a menu sheet on phone. The visitor widget has no navigation..

| Label | Route |
| --- | --- |
| All feedback | `/feedback` |
| Assigned to me | `/feedback?assignee=me` |
| Staff | `/staff` |
| Account | `/account` |

### Screens

#### Feedback chat widget `Any public page, opened from the Send feedback button`

Collect one short piece of feedback in a chat and an optional email. For: Visitor. Primary action: **Send feedback**. Stories: E1-1.

Layout, top to bottom:
1. Panel header: title and close button
2. Chat thread with the questions and answers
3. Optional email field
4. Primary button row pinned to the bottom

States:
- Empty: The first question is shown: What would you like us to know?
- Loading: Three-dot typing indicator in a visitor-side bubble while the message is sent.
- Error: Could not send your message. Your words are still here. Try again.

UI copy (use exactly):
- "What would you like us to know?"
- "Email, if you want a reply (optional)"
- "Send feedback"
- "Thanks. We read every message."

#### Sign in `/sign-in`

Send a one-time sign-in link to a work email. For: Staff member, Admin. Primary action: **Email me a link**. Stories: E2-1.

Layout, top to bottom:
1. Product name and one line of purpose
2. Work email field
3. Primary button
4. Help text about the link expiring

States:
- Empty: The email field is empty with the label Work email. No other content is needed.
- Loading: Button shows a spinner and the label Sending link.
- Error: We could not send the link. Check the address and try again.

UI copy (use exactly):
- "Sign in to Feedback Desk"
- "Work email"
- "Email me a link"
- "The link works once and expires in 15 minutes."

#### Check your email `/sign-in/check-email`

Tell staff the link is on its way and how to get back. For: Staff member, Admin. Primary action: **Open email app**. Stories: E2-1.

Layout, top to bottom:
1. Heading and the email address used
2. Short instruction line
3. Primary button to open the mail app
4. Quiet link to send a new link

States:
- Empty: Not applicable. This screen always has an address.
- Loading: Skeleton text line for the address until the session is read.
- Error: The link has expired or was already used. Request a new link.

UI copy (use exactly):
- "Check your email"
- "We sent a link to {email}."
- "Request a new link"

#### Feedback list `/feedback`

Show all feedback and let staff filter it by topic, urgency, status and assignee. For: Staff member, Admin. Primary action: **Filter feedback**. Stories: E3-2, E3-3.

Layout, top to bottom:
1. Top bar with title and count of open items
2. Filter chips for topic, urgency, status and assignee
3. Sortable list of feedback rows
4. Pagination or load more at the bottom

States:
- Empty: No feedback matches these filters. Clear filters to see everything.
- Loading: Six skeleton rows with the same height as feedback rows.
- Error: The list did not load. Try again.

UI copy (use exactly):
- "All feedback"
- "No feedback matches these filters."
- "Clear filters"
- "Try again"

#### Feedback item `/feedback/[id]`

Read one item with its chat, replies, status and tags, then assign, correct, reply and resolve it. For: Staff member, Admin. Primary action: **Send reply**. Stories: E3-4, E3-5, E3-6, E4-1, E3-2.

Layout, top to bottom:
1. Back link to the list and item title with visitor email
2. Status control and assignee menu
3. Visitor chat and staff replies in one thread
4. Tags with AI marker and correction menu
5. Reply composer pinned at the bottom

States:
- Empty: No replies yet. Write the first reply to the visitor below.
- Loading: Skeleton thread with two bubbles and a skeleton tag row.
- Error: This item could not load. Go back to the list or try again.

UI copy (use exactly):
- "Send reply"
- "No replies yet. Write the first reply to the visitor below."
- "Reply sent to {email}"
- "Assign to me"

#### Staff `/staff`

List staff members and invite new ones by email. For: Admin. Primary action: **Invite staff**. Stories: E2-2.

Layout, top to bottom:
1. Title and Invite staff button
2. Staff list with name, email and role
3. Pending invitations with resend action

States:
- Empty: No staff yet. Invite the first person who will answer feedback.
- Loading: Four skeleton rows for staff.
- Error: Staff list did not load. Try again.

UI copy (use exactly):
- "Invite staff"
- "Work email"
- "Send invitation"
- "No staff yet. Invite the first person who will answer feedback."

### Design checklist

**Apple design**

- Press feedback on pointer down (scale 0.98), not on release. Tap targets at least 44 px.
- Motion uses springs that can be interrupted, and leaves along the path it entered. Sheets and menus grow from the control that opened them.
- Bars and sheets are translucent layers; content scrolls underneath. The background dims only for modal tasks.
- Large text has negative tracking, small text slightly positive. Layout survives a larger text size.
- prefers-reduced-motion swaps motion for a short fade; prefers-reduced-transparency makes layers solid.
- Navigation labels say what the page holds (never Home). Every screen answers: where am I, where can I go, how do I get back.

**Both themes and every size**

- Text passes WCAG AA (4.5:1) in light and dark themes. Check both before calling a screen done.
- Every multi-column layout states its phone layout below 768 px; no horizontal scroll at 360 px wide.

## Ways of working

| Event | When | Purpose |
| --- | --- | --- |
| Sprint planning | First Monday, 1 hour | Turn the backlog into this sprint's plan and confirm the goal. |
| Daily check-in | Every day, 15 minutes | Done yesterday, doing today, anything blocking. |
| Sprint review (demo) | Last Friday, 30 minutes | Show working software to the product owner and stakeholders. |
| Retrospective | Last Friday, 30 minutes | One thing to keep, one to change in the next plan. |

About 3¼ hours per person per sprint. The plan is fixed up front; the check-ins and retrospective keep it flexible.

### Definition of Ready

- The story has a role, a want and a benefit.
- Its Done when checks are written and testable.
- Its screen is specified in the UI package (or it has no screen).
- It fits in one sprint.

### Definition of Done

- Every Done when check passes by using the app.
- Automated tests cover the new logic and pass in CI.
- Typecheck and lint pass; no new warnings.
- Another person (or a fresh agent session) has reviewed the change.
- The screen passes the Design checklist in light and dark themes.
- Works on a 360 px wide phone and on desktop.
- Every screen shows where the user is, where they can go and how to get back.
- Body text passes WCAG AA on the chosen background.
- Motion and transparency follow the reduced-motion and reduced-transparency settings.

## Risks

| Risk | Impact | What we do about it |
| --- | --- | --- |
| AI tagging is slow or fails under load | Medium | Save first, tag after, and fall back to Other and medium on failure. |
| Replies land in spam folders | High | Set up SPF, DKIM and DMARC for the sending domain before sprint 2. |
| Magic link emails are delayed or filtered | High | Send from a verified domain and test with two mail providers in sprint 1. |
| Spam bots fill the feedback chat | Medium | Add a rate limit per IP and a hidden honeypot field to the widget. |
| Two people cannot finish 26 points per sprint | High | Drop F10 first, since it is Could, then move F9 to the next sprint. |

## Weekly update template

For the manager, filled in from the board each Friday.

> **Feedback Desk, sprint 1**
> Goal: By Friday, a visitor can leave tagged feedback and invited staff can sign in and set status.
> Stories done: _n_ of 7 (26 points planned).
> Working now: _what was demoed_.
> Next: By Friday, staff can filter, assign, correct tags and reply by email.
> Risks: AI tagging is slow or fails under load
