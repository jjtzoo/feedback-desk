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

## Next steps
1. Browser tests: run the affected specs on their own ports, then update them to the new UI: `08, 09, 10, 11, 13, 14, 15, 18, 26, 27, 28` (`E2E_API_PORT=8132 E2E_WEB_PORT=3230 E2E_CONTROL_PORT=8142`). Refresh the mutation records for the specs that changed.
2. Spec: add D100 to D104 (check numbers are still free), update F13, the API list (remove /check), and record that D103 departs from D39's single feed (IA consensus) by the product owner's choice, consistent with D96. Sync the master copy in Documents.
3. Update README, docs/architecture.md and `Documents\Feedback test checklist.txt` (keep the [x] ticks).
4. Check both screens in a browser at desktop and 375 px.
