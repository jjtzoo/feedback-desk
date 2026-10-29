# Handoff: item conversations (2026-10-28)

Branch `feat/item-conversations` (worktree `C:\Apps\Feedback\.claude\worktrees\item-conversations`), cut from `feat/staff-general-view` (main + 5B + 5D). Committed and pushed to both remotes.

## What's built (from the user's notes on the latest update)
- D100 Tracker: one Activity feed (messages + stage changes, newest first), comment box at its top (JSM portal pattern from `C:\benchmark\research`). Replaces the "asked you to check" card, Tracking history and the bottom Reply or add details form. Latest update stays (brief).
- D101 The reporter's conversation includes the holder and the approver; a reporter comment notifies the holder, the approver and Digital Staff who replied (`notifications.in_conversation`). The tracker names the approver (`TrackerOut.approver`).
- D102 Updates ask nothing: D80's It's fixed / Still happening, `POST /feedback/{ref}/check` and the Update dialog's "Ask them to check it" are removed. Is it fixed? on Resolved stays (D92). The `asks_check` column is kept for older messages (no migration).
- D103 Console panel tabs: Brief (intake transcript folded at the bottom) · With <name> · Team · History · Files. A Team note notifies the holder, the approver and others who wrote there (`team_note`). Message links are `/console?item=X&msg=ID`, and the panel picks the tab from the message.
- D104 Properties are held until Save (with Cancel); one PATCH.

## Checks
- Backend: ruff, mypy, 179 tests pass. Web: tsc and eslint pass. `npm run build` has not been run yet.

## Finished (2026-10-29)
- Browser tests: the 11 affected specs updated to the new UI; 106 pass, 1 skipped; mutation checks for 08, 09, 10, 13, 14, 15, 18, 26 and 28 caught every broken test.
- Spec: D100 to D104 added, F13, D80 and the staff API list updated; master copy in Documents synced. README, `docs/architecture.md` and the checklist updated.
- Web build passes. Checked in a browser: the tracker at 1280 and 375 px; the panel's five tabs now scroll sideways on a phone instead of clipping the last one.
- Left: the full browser suite on this branch before it merges into `main`.
