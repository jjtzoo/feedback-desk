# PROJECT HUB - 2026-40 Feedback Desk

Draft of the Evernote Project Hub note, written to the Digital Staff Project Information Architecture and Document Control standard. Paste it into the note created from the "PROJECT HUB" template; the repo copy stays the source for the technical facts. Detail lives in the spec, not here.

## 1. Project

| Field | Value |
| --- | --- |
| Project ID and title | 2026-40 Feedback Desk |
| Smartsheet status | Active (confirm in the DS Projects - Master List) |
| Sponsor | Chris (IT Director) |
| Team lead and reviewer | Marc (Team Lead AI Engineer) |
| Developer | Jacob Toledo |
| Brief | Marc's Feedback-Project-Brief, 2026-10-19 (governs scope and architecture) |

**Summary.** A chat agent where any REDADAIR staff member gives feedback on an intranet platform or agent, and a console where Digital Staff triage, approve, work and close it. Staff track each item like a parcel. The agent classifies the feedback, writes a developer brief and hands it to code that assigns the owner; an Admin approves or declines before anyone works on it.

**Not** a ticketing system: no SLAs, escalation chains or customer-facing tickets.

## 2. Requirements and success measures

- Requirements reference: [requirements.md](requirements.md)
- Full spec (source of truth): [feedback-build-spec-v3.md](feedback-build-spec-v3.md)
- Success measures (first 60 days after launch): 80 % of feedback through the agent, 90 % correct project, 80 % correct assignee, first response under 2 business days, a chat under 2 minutes, 70 % of true duplicates linked.

## 3. Linked systems (SOP section 4)

| System | Location | Link |
| --- | --- | --- |
| Smartsheet master list | Row 2026-40 Feedback Desk | TODO |
| Smartsheet project plan | DS Active Projects > 2026-40 Feedback Desk | TODO |
| Google Drive | Shared Drives > DS Active and Proposed Projects > 2026-40 Feedback Desk | TODO |
| Google Chat space | 2026-40 Feedback Desk | TODO |
| Lucidchart | My documents > DS Projects > 2026-40 Feedback Desk | TODO |
| Code repository | `2026-40_Feedback_Desk` (currently `feedback-desk`, see below) | TODO |
| Google Cloud project | DS Projects folder > `2026-40_Feedback_Desk` | TODO (not created; asks 1 and 9 in the spec) |

## 4. Technical

Stack, environments and deployment: [architecture.md](architecture.md), [deployment.md](deployment.md). Company standards followed: [standards/](standards/).

## 5. Stakeholders

Marc (reviewer, signs each gate), Chris (sponsor, signs each gate), Mike (approver of feedback), Darlene and Mario (project owners in the catalogue), pilot staff from REDMEN, ADAIR and offshore ops.

## 6. Status and open items

Build status: spec section "Build status". Open decisions: D31 (PostgreSQL version), D32 (email provider), D35 (production domain), D37 (Smoke Signal brand), proposed model and spend limits in D36.

**Known deviations from the SOP and company standards**
- The repository is a temporary private repository outside the company GitHub organisation, used for development. It moves into the company org (spec ask 5, D27) and is renamed `2026-40_Feedback_Desk`; the temporary copy is then deleted.
- No Google Cloud project, Evernote notebook, Drive folder, Chat space or Lucid folder exists yet for this ID.
