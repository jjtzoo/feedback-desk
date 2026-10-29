# Findings from the browser tests

Bugs the browser tests found in the app. Each one has a test marked `test.fail()` that names the same ID; when the app is fixed, that test passes unexpectedly and `test.fail()` comes out. App fixes are separate changes (e2e/CLAUDE.md, rule 1).

Format:

```
## S00.00 Short title
- Test: e2e/<file>: <test title>
- Steps: what the test does
- Expected: what the checklist says
- Actual: what the app did
- Found: YYYY-MM-DD
```

## S10.02 The bell count does not rise until the page is reloaded
- Test: e2e/10-notifications.spec.ts: S10.02 Mario's bell count rises within a few seconds without a refresh
- Steps: as Liam, raise an item and have Marc approve it; open its tracker (the bell reads "1 unread"); as Darlene, post an update on it; wait 8 s without reloading.
- Expected: the bell count rises within a few seconds without a refresh.
- Actual: the bell stays at "1 unread"; after a reload it reads 2. The API's stream sends `event: unread` at once (seen directly on 8002, and through 3100 without gzip), but through the web server a browser's `Accept-Encoding: gzip` gets the stream back `Content-Encoding: gzip`: Next's default `compress: true` gzips the proxied `text/event-stream` (it has no `Cache-Control: no-transform`), and zlib holds the small events and the 15 s pings in its buffer. The connection stays open, so the bell's `onerror` never fires and its 30 s polling fallback never starts either. The same applies to `next dev` and the standalone server on Cloud Run, and the chat's own stream is gzipped the same way. Possible fixes (a separate change): send SSE responses with `Cache-Control: no-cache, no-transform`, or set `compress: false`.
- Related, not tested: after any stream error (an API restart or deploy, Cloud Run's request timeout) the bell closes the stream for good and polls every 30 s; it never reconnects.
- Found: 2026-10-23
- Fixed: 2026-10-23 on `fix/live-bell-stream`. The API sends both event streams (bell and chat) with `Cache-Control: no-cache, no-transform`, which Next's compression honours, so they arrive uncompressed (checked with curl through the web server with `Accept-Encoding: gzip`); `test_streams_tell_the_web_proxy_not_to_compress` keeps it that way. The bell no longer closes the stream on an error: the browser retries a dropped connection itself, the bell reconnects with a growing delay (5 s to 60 s) when the browser gives up, and it polls only while the stream is down. Checked by hand: after stopping and restarting the API, the bell reconnected and rose from 2 to 3 within 6 s without a reload. S10.02 passes, its `test.fail()` is out, and mutation 10 caught 8/8. The reconnect has no browser test (not a checklist item).

## S22.05 A limit reached mid-chat does not switch to the backup form
- Test: e2e/22-ai-usage.spec.ts: S22.05 Reaching a limit mid-chat: the backup form takes over with your text kept, and an existing confirm card can still be confirmed
- Steps: as Tom, start two chats and bring one to its confirm card; record usage up to his daily limit; confirm the card (this half works: "Sent. Your reference is FB-…"); send another message in the other chat.
- Expected: the backup form takes over with what was typed kept.
- Actual: Sig keeps answering, the allowance line reads "100% used" and no form appears. Limits are checked only at `POST /api/chat/sessions`. This is deliberate in spec D36 ("a chat in progress always finishes") and in `backend/tests/test_usage.py`, so the checklist and the spec disagree: recorded as OPEN in D36 for Marc.
- Found: 2026-10-23
- Decided: 2026-10-29 by the product owner, on `fix/allowance-early-warning`: the chat finishes, and people are warned early instead (D36). At 80 % Sig says once in the chat that this report will still finish. The checklist item now expects the chat to carry on and a new chat to open the backup form; S22.05 asserts that and its `test.fail()` is out.

## S26.02 (related) A tracker reply's password, card number and TFN reach the owner's bell unmasked
- Test: none yet. `e2e/26-masking.spec.ts` S26.02 checks the Conversation tab and the tracker, which are masked; the notification is not in the checklist item. Found by reading the code and confirmed against the running test app.
- Steps: as a staff member, reply on the tracker with "My password is Hunter2, card 4111 1111 1111 1111, TFN 123 456 782"; sign in as the item's owner and read `GET /api/notifications` (the bell).
- Expected: the checklist asks for masking before anything is stored (Brief §5.5), as the saved message is.
- Actual: the bell's notification body is "The Flipbook login is broken. My password is Hunter2, card 4111 1111 1111 1111, TFN 123 456 782". In `backend/app/services/feedback.py`, `submitter_reply` saves `mask(body.strip())` as the message (line 435) but passes the original `body[:300]` to `notifications.notify_assignee` (line 457). The notification is stored with the secrets, and is probably emailed the same way. Probably also the staff-chat paths that notify with raw text: not checked.
- Found: 2026-10-22
- Fixed: 2026-10-23 on `fix/mask-notification-text`. `notifications.notify` now masks every title and body before storing it (so the email is masked too), and cuts to 300 characters only after masking; callers no longer cut first, which could have split a card number below the length `mask` recognises. That covers all 23 notify calls, including channel mentions and console replies. `mask` no longer garbles already-masked text ("[password removed] removed]"), which the backup form's submitter quote hit. Tests: `test_notifications_are_masked_before_they_are_stored`, `test_masking_twice_changes_nothing`. Still no browser test: the checklist item covers the Conversation tab and the tracker only.

## S28.01 The chat's hidden file input is a Tab stop with no visible focus ring
- Test: e2e/28-keyboard.spec.ts: S28.01 (landing, tracker and console pass; the chat ring check is `test.fail()`)
- Steps: sign in as a staff member, open `/chat`, press Tab from the top of the page.
- Expected: every control reached by Tab shows a visible focus ring, with no invisible stops.
- Actual: after "Back to home", Tab lands on a clipped 1 x 1 px file input (`input#chat-files`, `web/src/components/chat/chat-panel.tsx`) before the "Attach a file" button, and nothing shows focus.
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/keyboard-and-small-ui`. The file input has `tabIndex={-1}`, so "Attach a file" is the only stop. S28.01 passes, its `test.fail()` is out, mutation 28 caught 5/5.

## S28.03 After Esc closes a dialog, focus does not return to the button that opened it
- Test: e2e/28-keyboard.spec.ts: S28.03 (`test.fail()`)
- Steps: as Chris, open the approvals page with an item awaiting approval, press Enter on Decline, then Esc.
- Expected: the dialog closes and focus returns to the Decline button; Tab stays inside while it is open.
- Actual: the dialog closes and Tab stays inside, but focus is not on Decline afterwards (probably the page body). The dialogs open through a controlled `open` prop with no trigger, so Radix has nothing to return focus to.
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/keyboard-and-small-ui`. `ActionDialog` remembers the focused element when the dialog opens and focuses it again on close (`onOpenAutoFocus` / `onCloseAutoFocus`). S28.03 passes, its `test.fail()` is out. Its mutation now expects focus on the card instead of inverting the check, because `not.toBeFocused()` passes in the tick before focus returns.

## S13.08 Internal notes have no lock icon
- Test: e2e/13-item-panel.spec.ts: S13.08 (the dashed border and the "Internal note" label are asserted first; only the lock icon is `test.fail()`)
- Steps: as Darlene, raise a bug as a staff member, post an internal note (`POST /api/console/items/<ref>/note`), open the item panel and its Conversation tab.
- Expected: the note is dashed, labelled "Internal note" and has a lock icon (checklist S13.08).
- Actual: dashed border and label are there, no lock icon. `web/src/components/console/item-panel.tsx` has no lock icon.
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/keyboard-and-small-ui`. Internal notes show a `Lock` icon (hidden from screen readers; the "Internal note" label already says it). S13.08 passes, its `test.fail()` is out, mutation 13 caught 11/11.

## S14.05 After Resolve, the newest tracker entry is "Update", with "Resolved" second
- Test: e2e/14-status-changes.spec.ts: S14.05 (the "Resolved: <note>" entry is asserted present; only "it is the first entry" is `test.fail()`)
- Steps: raise a RAKE Agent bug, approve it, start work, Resolve with a note, open the tracker as the submitter and read the newest entry in Tracking history.
- Expected: the checklist says the note becomes the tracker's last entry, "Resolved: <note>". Reading "last" as "newest" is an assumption: confirm the reading before treating this as a bug.
- Actual: the newest entry is "Update: <note>" and "Resolved: <note>" is second. Resolving writes the note and the status change in one transaction; the status event is flushed before the message, so the message gets the later `created_at` and the history sorts it first. Both entries are shown; only the order is odd.
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/badges-order-tour`. `resolve()` stamps its progress message 1 ms before the status event, so "Resolved: <note>" is the newest tracker entry and "Update: <note>" sits below it. S14.05 passes and its `test.fail()` is out; `test_lifecycle.py` checks the order.

## Outside the checklist: small things the browser tests noticed
- Fixed 2026-10-25 on `fix/keyboard-and-small-ui`: the dashboard's "Open by project" section had `aria-labelledby="bl-Open by project"`, an id with spaces, so the section had no accessible name. `BarList` now uses `useId()`.
- Fixed 2026-10-25 on `fix/keyboard-and-small-ui`: the item panel (and My feedback) read "now ago" in the first minute. `ago()` in `web/src/lib/format.ts` gives "just now"; S07.02, S13.02 and the backup-form header check now expect it.
- S13.06: the tracker says "Reassigned to Mario" where the checklist says "Assigned to Mario". Treated as wording, not a bug; the test asserts the app's wording. Found 2026-10-22.
- Fixed 2026-10-25 on `fix/badges-order-tour` (all but the card still covering a corner, which is now one 64 px row): the spotlight ring is a 4 px box-shadow, keys other than Tab and Esc are blocked outside the highlighted control while a click is awaited, leaving an area mid-tour marks it seen, and the Guide button restarts the tour cleanly. S02.03 expects the ring. Original note: guide tour (S02.03, S02.04, S02.05), from reading `web/src/components/guide.tsx`: the spotlight's solid `ring-4 ring-primary` never renders (Tailwind v4 rings are box-shadows and the inline dimming `boxShadow` overrides them), so the only red is the pulsing outline at 60 % opacity; the small card is shorter but not narrower. While the small card asks for a click, mouse clicks elsewhere are blocked but the keyboard is not: Tab reaches page controls, and Radix triggers that open on keydown (the account menu, "Already know which tool?") still open. The "Try it out" card covers about 352 x 130 px at the bottom right, and controls under it can't be clicked until Next. Pressing Guide during "Try it out" gives a "Try it out … Have a look at Welcome to Smoke Signal" card; moving between the staff area and the console mid-tour ends the tour without marking it seen. Found 2026-10-23.

## S12.04 The board card shows the work type as plain text, not a badge
- Test: e2e/12-board.spec.ts: S12.04 (asserts the work type as text in the card's meta line; not marked `test.fail()`)
- Expected: the checklist lists "work type badge" and "priority badge" on a card.
- Actual: the priority is a badge; the work type is plain text in the meta line. Confirm whether the checklist or the card is right.
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/badges-order-tour`. The card shows the work type as a `WorkTypeBadge` beside the priority; the meta line is now "tool · submitter". S12.04 asserts the badge.

## Closed: results that went wrong once (Stage 3 repeat runs, 2026-10-23)
Each failed or misreported once on 2026-10-22. The causes below come from the server logs and the code; after the test fixes, every test in each file passed 10 separate runs in a row (`e2e/evidence/stress.json`).
- First full run, 2026-10-22 (about 09:11), 1 of 83 failed: it was S09.03. The web server's `/api` proxy dropped the tracker request (`read ECONNRESET`, see "the web server's /api proxy now and then drops a request" below). No test change; spec 09 10/10.
- S11.01, the reset timed out at 60 s once: the cause is not in the records (the machine-wide pgserver lock or a slow `uv` start are suspects). The reset now runs without `cmd.exe`, so the limit ends `uv` itself and a failure reports its time and output. Spec 11 10/10.
- S12.13, the Project filter listed only "All projects": the same proxy drop, on `GET /api/projects`, which the page never retries. The test now fails fast with the status instead of hanging. Spec 12 10/10.
- S13.01, "broken test still passed" once: a test weakness. The check sampled the panel during its 200 ms slide-in, where the broken value is a real frame; it now measures after the animation ends. Mutation 13 and spec 13 10/10.
- S21.03, timed out instead of failing in one mutation run: a test weakness. After each failure Playwright restarts the worker, and the test rebuilt its six items inside its own time; a hung chat request had no timeout. The items are now built in `beforeAll` and the API helpers time out at 30 s. Mutation 21 and spec 21 10/10.
- S01.05, the greeting missing twice: a race in the test. It signed out while `/console` was still loading, the page's next board load got a 401, and the app's own redirect to `/sign-in?next=/console` raced the test's next `goto`, so Liam landed on the console. The test now leaves the page before signing out. Mutation 01 and spec 01 10/10. Outside the checklist and harmless: someone who signs out from the menu while the console loads can land on `/sign-in?next=/console`.

## S22.01 The allowance line and meter are hidden until half the allowance is used
- Test: e2e/22-ai-usage.spec.ts: S22.01 (`test.fail()`)
- Steps: sign in as Aisha (staff, no usage), open `/chat`, wait for the Sig greeting, look under the message box.
- Expected: "Today's assistant allowance: N% used" with a meter (checklist section 22, item 1).
- Actual: nothing is shown. `src/components/chat/usage-meter.tsx` returns null below 50 %, and its comment says "Quiet until half is used". Either the checklist line is stale (a product call, given the Quiet UI direction) or the meter should always show. The "hidden when the limit is 0" half cannot be reached because the test API fixes the limit.
- Found: 2026-10-22
- Decided: 2026-10-29 by the product owner, on `fix/allowance-early-warning`: the meter stays quiet below 50 % (D36). The checklist line now says so; S22.01 asserts nothing shows at 0 % and the line and meter show at 50 %, and its `test.fail()` is out.

## Wording differences in sections 2 and 22 (not bugs, checklist to update)
- S02.11, S02.12: "RAKE Agent chip pressed", but `/chat` shows a static "About RAKE Agent" pill with no pressed state.
- S02.13: the landing page shows the status wording "Received, waiting for approval", not a stage badge.
- S02.15: the footer says "tax file numbers", not "TFNs".
- S02.02: OK shows only on steps that ask for a click. "Your console" (the Console button) and the console's "Smoke Signal home" (a link) spotlight something clickable but show Next, and the last step, "That's it", shows Done. The test asserts the app's rule ("steps that ask you to click"); whether the checklist means that is the user's call.
- S02.08: both tours end with a "That's it" step the checklist does not list (6 steps for Mario, 8 for Chris).
- S01.03: the picker shows a job title for staff, not an email (by design); the test reads "each with an email" as applying to the five Admin and Digital people.

## S07.02 My feedback rows have no stage badge
- Test: e2e/07-my-feedback.spec.ts: S07.02 (the rest of the row is checked first; only the badge is `test.fail()`)
- Steps: sign in as a staff member with an item, open `/my`, read the row.
- Expected: "FB reference, title, tool (or "Tool to confirm"), a plain status, "updated … ago", and a stage badge on wider screens" (Brief §4.1.8).
- Actual: the row shows everything except the stage badge. `StageBadge` exists in `src/components/badges.tsx` but nothing renders it, and `src/app/(staff)/my/page.tsx` never uses it. Either the page should show it or the checklist line should go (a product call, given the Quiet UI direction).
- Found: 2026-10-22
- Fixed: 2026-10-25 on `fix/badges-order-tour`. Each row shows the `StageBadge` on screens from `sm` up. S07.02 passes and its `test.fail()` is out.

## Outside the checklist: the web server's /api proxy now and then drops a request with a 500
- Test: none of its own; it surfaces as a one-off failure in any test (see "went wrong once" above).
- Steps: run the browser tests for a few hours; watch the web server's output for `Failed to proxy`.
- Expected: every `/api/*` request reaches the API.
- Actual: about 1 in 12,000 proxied requests fails with `read ECONNRESET` or `socket hang up`, and the browser gets `500 Internal Server Error`. Seen 3 times on 2026-10-22: `GET /api/feedback/FB-0003/tracker` (S09.03, first full run), `GET /api/projects` (S12.13) and `POST /api/console/items/FB-0001/approve` (an S21 mutation run). Likely cause: `web/src/proxy.ts` rewrites `/api/*` through Next's keep-alive agent, which has no idle timeout, while uvicorn closes idle keep-alive connections after 5 s (`timeout_keep_alive` default, set neither in `e2e_server.py` nor in the Dockerfile); a request sent on a socket uvicorn is closing fails. Possible fixes (a separate change): a uvicorn `--timeout-keep-alive` longer than the proxy's idle time, or no keep-alive on the proxy leg.
- Fixed: 2026-10-25 on `fix/proxy-keep-alive`. uvicorn now runs with `--timeout-keep-alive 620` in the Dockerfile, `scripts/dev_server.py` and `scripts/e2e_server.py`, so the API never closes an idle connection first (Next's proxy, httpxy over Node's global agent, drops idle sockets after about 5 s; 620 s is above Google's load balancer idle time too). No new test: the drop was about 1 in 12,000 requests, so it can only be shown by a long run; the repeat runs and the full suite are the check.
- Seen again: 2026-10-29, 4-shard full run on `infra/e2e-shards` (4bf4a7d), CPU about 80 % busy. Shard 4's `POST /api/console/items/FB-0011/approve` failed with `read ECONNRESET` (S10.12), and an approve drag in S18.08 never reached the Approved column. Both passed in the 1-, 2- and 3-shard runs of the same commit, so the 620 s keep-alive did not remove every drop; it shows up under heavy load. Not fixed; the full run's default stays at 2 shards.
- Related: when `GET /api/projects` (or `/api/admin/digital-staff`) fails, the console's Work filters stay empty for the life of the page with no message (`web/src/app/console/page.tsx`, `.catch(() => undefined)`); and the notification stream checks the sign-in only when it opens, so after signing out an open page keeps getting unread counts until it navigates.
- Fixed: 2026-10-25 on `fix/findings-polish`, both. The console shows "The Project filter and the assignee list did not load" with a Try again button (browser test "The console says so, and loads the filters on Try again…", shown able to fail). The notification stream re-checks the session each cycle in its own short transaction and ends when the person has signed out or the session is revoked or expired (`test_notification_stream_ends_when_the_person_signs_out`; the first version of the check ran inside the event's transaction and `test_notification_stream_holds_no_transaction` caught it).
- Fixed: 2026-10-25 on `fix/findings-polish`, the tour's "Try it out" card covering a corner: it now sits at the top when the control being tried is in the lower half of the screen, at the bottom otherwise (it is one row, about 64 px, since `fix/badges-order-tour`).
- Found: 2026-10-22 (from the web server log; written up 2026-10-23)

## Outside the checklist: the live notification stream holds a database transaction open
- Test: none (found while building the database reset; `backend/scripts/e2e_reset.py` works around it in the test database only)
- Steps: sign in, open any page with the bell (it opens `GET /api/notifications/stream`), then look at `pg_stat_activity`.
- Expected: the stream checks Postgres every 3 seconds in short transactions (`app/api/notifications.py`) and holds nothing in between.
- Actual: the request's sign-in lookup (the `CurrentUser` dependency's session) stays `idle in transaction` for as long as the page is open: seen at 96 s and growing. It holds share locks on `app.digital_staff` and `app.user_sessions` and keeps one pooled connection per open tab. Consequences: a `TRUNCATE`, and any migration that alters those tables (`ALTER TABLE` during a deploy), waits until every tab closes; and with many staff online the connection pool and Cloud SQL's connection limit fill up.
- Found: 2026-10-22
- Fixed: 74dd7f3 (merged in 9874225), with `backend/tests/test_streams.py`. What is left: the stream holds a transaction for the few milliseconds it takes to write each event.

## Outside the checklist: a write is answered before it is committed, so the next request can miss it
- Test: none of its own; it surfaced on 2026-10-25 as "No confirm card for: …" from `raise()`, a page showing Sign in straight after a successful dev sign-in, `GET /console/items … -> 401` (S12.15), and a board that never loaded (S12.11), in S02.03 to S02.15, S07.01, S12.01, S12.11, S12.15 and S14.01 to S14.06. Each passed when run alone.
- Steps: run specs 07, 12 and 14 in one go on a busy machine (the backend suite took 17 minutes that day).
- Expected: once the API answers 204 to a sign-in, the next request with that cookie is signed in; once it answers 2xx to any write, the write is saved.
- Actual: `Db` (`app/api/deps.py`) used FastAPI's default dependency scope, "request", whose exit code (`get_db`'s `commit()`) runs after the response is sent (`fastapi/routing.py`, `await response(...)` inside the request exit stack). A client that acted on the 2xx at once could reach the API before the commit: a new session was not there yet (401, so the page went to Sign in and `raise()` got no chat), and a commit that failed after the response would have been reported as a success. Every write route was affected, not only sign-in; real browsers do the same (sign in, then load the page), so this was an app bug, not a test one.
- Found: 2026-10-25
- Fixed: 2026-10-25 on `fix/chat-setup-flake`. `Db` is `Depends(get_db, scope="function")`, so the commit runs when the route returns, before the response. `test_a_write_is_committed_before_its_response_is_sent` drives the app through raw ASGI and looks the new session up from another connection at the moment the response starts. `raise()` now puts every status and event it got into its error, so a failed setup explains itself. It failed the same way on the code before that day's other changes (S14.03 on `3492ef6`), which is how it was told apart from them. After the fix, specs 07, 12 and 14 in one run: 27 passed, no setup failures (3.2 min, against 4 to 11 min before).
