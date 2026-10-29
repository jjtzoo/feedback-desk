# Feedback: demo run sheet

One problem from report to fix, switching accounts as you go. Updated 29 Oct after the merge, duplicate and chat changes.

**Before you start:** the app must run on Gemini (the preview at http://localhost:3040 does), so Sig chats naturally and duplicates match by meaning. Start from fresh data so references begin at FB-0001. Sign in with the picker.
**Tip:** keep a second, private window open as whoever is waiting for news, to show the bell rising without a refresh.

Cast: **Liam Carter** (reports it) · **Aisha Rahman** and **Tom Nguyen** (other staff) · **Chris** (Admin) · **Darlene** (developer, owns RAKE Agent)

---

## 1. Liam reports a problem
1. Sign in as **Liam**. Open **Give feedback**.
2. Sig greets him with the app cards. Click **RAKE Agent**. Sig goes straight to what happened; it never asks which tool.
3. Type: *The RAKE Agent is slow with big PDFs, it times out after a minute.* Answer Sig's questions (3 at most).
4. Paste a screenshot (Ctrl+V). A thumbnail appears with "Check it doesn't show passwords or card numbers".
5. Check the summary card and press **Confirm**. Expect "Sent. Your reference is FB-0001", who has it, and "An Admin will approve it before work starts."
6. Open **My feedback**, then the item: the tracker with its stage and the Conversation.

Optional: add *my password is Hunter2* in step 3; it is stored as "[password removed]".

## 2. Another staff member sees only general information
1. Sign in as **Aisha**. Either paste `http://localhost:3040/track/FB-0001` into the **browser's address bar**, or type *FB-0001* to Sig and click **Open FB-0001** under its answer. (Sig never looks items up itself.)
2. Expect "FB-0001 · Someone else's feedback": stage, what it's about, progress updates. **No names, no messages, no files.** No approval is needed for this view.
3. Click **This affects me too**. She now follows it ("You're following this").

## 3. The same problem, in other words
1. Sign in as **Tom**. **Give feedback**, click **RAKE Agent**, type *When uploading big PDF file it timeouts.* and answer Sig.
2. Sig says "Looks like someone may have raised this already: FB-0001…" and shows the summary card in the same reply. The box reads **Someone may have raised this already**, with **View it**, **Add my comment there instead**, and "Different problem? Press Confirm below to send yours as new."
3. For the demo, press **Confirm** to send it as new: Tom gets **FB-0002** (merged in step 4).
   (Show the other way too if you like: **Add my comment there instead** gives "Added to FB-0001" and no new reference.)

## 4. Chris merges and approves
1. Sign in as **Chris**. The console opens; **Approvals** is first in the sidebar, with a count.
2. Optional: on FB-0001 click **Ask a question**. The item opens on its Conversation; switch to **Reply to Liam**, ask *Does it happen with every PDF or only big ones?* and press **Send to Liam**. Liam sees it on his tracker.
3. Open **FB-0001**. At the top, the amber **Possible duplicates** box shows FB-0002 with its % similar. Click **Merge**.
4. The dialog asks **"Merge FB-0002 into FB-0001?"**: the newer one closes as a duplicate of the first report, its people follow FB-0001, and there's no undo. Click **Yes, merge**. (The rule: the older ticket always takes in the newer one, whichever you click from.)
5. FB-0001 now shows "Merged here: FB-0002", **Reported by 3 people** (Liam, Aisha, Tom) and **Priority review suggested**. Tom's tracker says "Duplicate of FB-0001".
6. Click **Approve** (in the item's header, or on the Approvals page). Write **Instructions for the developer (optional)**: *Check the PDF size limit first and keep Liam posted.* Raise the priority if the review suggests it, set a **Due** date, and approve.

## 5. Darlene works on it and asks Chris something
1. Sign in as **Darlene**. The bell has the item; it is in **Assigned to me**.
2. Open it. Chris's instructions are pinned at the top ("From Chris, at approval").
3. **Status**, then **Start work**. The Status button lists only the moves allowed now.
4. Open **Conversation**. The box starts on **Internal note**. Write *Is 50 MB the limit we agreed?* and press **Add internal note**. Liam never sees it.
5. Switch to **Reply to Liam**: *I can reproduce it and I'm working on a fix.* Press **Send to Liam**. The box goes back to Internal note by itself.
6. Next to **Due**, click **Change** and move the date later. The "Change the due date" dialog asks why (internal), and Chris is told.

## 6. Chris answers Darlene
1. Sign in as **Chris**. The bell shows Darlene's note and the date change.
2. Open the item's **Conversation** and answer with an **Internal note**: *Yes, 50 MB.*

## 7. Liam talks to the team
1. Sign in as **Liam**. The bell has Darlene's reply.
2. On the tracker's Conversation: Darlene's message and Sig's plain words on each move; no internal notes. "In this conversation" lists each person once.
3. Above the box: "Your messages go to Darlene, who has it and Chris, who approved it." In **Write a message or add details**, type *It also happens with 20 MB files*, paste a screenshot, press **Send**.

## 8. Darlene resolves it
1. Sign in as **Darlene**. The bell has Liam's message.
2. **Reply to Liam** with an image of the fix: *Fixed, here's how it looks now.* Press **Send to Liam**.
3. **Status**, then **Resolve…**, with a note written for Liam.

## 9. Liam checks the fix
1. Sign in as **Liam**. The tracker asks **Is it fixed?**
2. Click **I still have an issue** and say what's still wrong (a screenshot is optional). Expect "Thanks. It's back with the owner." It returns to In progress with Darlene, who is told.
3. As **Darlene**: **Status**, then **Resolve…** again. As **Liam**: **Yes, close it**. Expect "Closed as fixed. Thanks for letting us know."
4. As **Aisha** and **Tom**: their bells say it is fixed, because they follow it.
5. Say: if Liam never answers, he gets one reminder after 3 days and it closes itself as Fixed after 7.

## 10. Wrap-up
1. As **Chris**: **Releases**, then **Draft this week now**. As **Darlene** (the owner): open the RAKE Agent draft and click **Approve and publish**.
2. As **Liam**: **Fixes and updates** shows the release, with his item marked **From your feedback**.
3. As **Chris**: **Dashboard** shows open items, time to first response and the weekly trend.

---

**If asked:** an Admin can close a Resolved item (**Status**, then **Close as fixed…**, with a reason); Mario can **Take over** from Darlene; if Gemini is down or the allowance runs out, the chat becomes a plain form; it all works on a phone.
