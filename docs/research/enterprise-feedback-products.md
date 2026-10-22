# Enterprise feedback and request products: how their AI agents behave

Task 1 of 2: research only. This file describes what other products say they do, with the main focus on how their AI agents behave. It does not mention or compare against the Feedback codebase; that is task 2.

Second pass, researched 2026-10-22 from vendor documentation and web search. It replaces the first pass, which listed features but said little about agent behaviour.

Each claim carries a confidence mark:

- **Official**: the vendor's own documentation or product page.
- **Secondhand**: a review site, consultancy, partner or press article. Treat as directional.
- **Unconfirmed**: not found, or sources conflict. Listed so nobody assumes it.

Vendor accuracy and resolution figures are the vendor's own and were not independently verified. Pricing and plan limits change often.

## Products covered

| Product | What its agent is for | Closest to |
| --- | --- | --- |
| Canny Autopilot | Captures feature requests from sales and support conversations and review sites, merges duplicates | Feedback capture |
| Featurebase Autopilot (and Fibi) | Links feedback to requests, suggests or applies merges | Feedback capture |
| Productboard Spark | Agent for product managers: feedback analysis, specs, research | Feedback analysis |
| Jira Service Management: virtual service agent and Request Router (formerly Service Triage agent) | Answers employees, raises requests, triages incoming requests | Employee intake and triage |
| ServiceNow AI Agents and Virtual Agent | Multi-step agents over service workflows, approvals | Employee service |
| Moveworks (ServiceNow-owned) | Employee assistant that reasons, plans and runs plugins across company systems | Employee assistant |
| Freshworks Freddy (Freshservice, Freshdesk) | Self-service agent and auto triage of tickets | Triage |
| Intercom Fin | Customer support agent with procedures and escalation rules | Conversation agent |
| Zendesk AI agents | Autonomous resolution and intelligent triage | Conversation agent and triage |

Also looked at in the first pass, with no agent behaviour found: UserVoice (AI only through third-party add-ons), Jira Product Discovery (automation rules, no agent). Not researched: Aha! Ideas.

## 1. Agent behaviour, product by product

### Canny Autopilot

- **Does by itself:** reads conversations from Gong, Intercom, Slack, Zendesk, Help Scout, Freshdesk, Zoom, tl;dv and review sites (G2, Capterra, Trustpilot, app stores); captures feature requests; merges repeat requests; sorts them by product area; links each to its customer, account and revenue. "No manual work required." *Official* ([Autopilot page](https://canny.io/features/autopilot))
- **Talks to customers:** "Smart Replies" ask customers follow-up questions automatically. How they are generated or reviewed is not described. *Official, detail missing*
- **Human control:** a full audit log of what it captured, merged and organised; "you can undo any action." Captured feedback stays internal until someone publishes it; publishing can be set per source. *Official*
- **Suggest-then-approve mode:** one review says it can run automatically or "suggests and you approve." Not on Canny's own page. *Secondhand ([Formbricks comparison](https://formbricks.com/blog/canny-vs-productboard-vs-featurebase))*
- **Context for decisions:** shows how urgent a request is for a customer, surfaces themes, summarises long comment threads. *Official*
- **Data:** "We don't use your data to train our models." SOC 2 Type 2. *Official*
- **Accuracy claim:** 93 % of feature requests identified and 30 % more captured than a manual process, in one customer's audit of 1,725 tickets. *Vendor claim*

### Featurebase Autopilot

- **Three automation levels**, chosen by an admin: *Official ([Feedback 2.0 article](https://help.featurebase.app/en/articles/6686694-feedback-20-whats-changed-for-existing-users))*
  - Off: "Your team reviews feedback and links or merges it manually."
  - Assisted: "AI links matching Insights; your team reviews suggested merges."
  - Automatic: "AI also merges clear duplicates; your team reviews uncertain matches."
- **Model of the data:** a Request is the tracked item; each piece of feedback is an Insight linked to it, from a portal submission or a quote from a conversation. *Official*
- **Rewrites submissions:** an optional setting rewrites incoming submissions and splits one submission that holds several requests into separate Requests. It does not rewrite the existing backlog. *Official*
- **Triage queue:** holds feedback that needs a decision: possible duplicates, requests awaiting approval, customer questions, suspected spam. *Official*
- **Corrections:** "Not a duplicate," unlink an Insight, unmerge a Request (unmerging deletes replies added after the merge). *Official*
- **Telling customers:** on a status change, send a default or custom update, optionally as a reply in the linked support conversation. Linking a private source does not publish it. *Official*
- **Earlier AI:** similar-post suggestions (2023), grouping and "Find duplicates" view (2024, Business plan), AI tagging from admin rules (2026). *Official ([changelog](https://feedback.featurebase.app/changelog))*
- **Fibi (support agent):** reported to submit feature requests to boards for customers and to classify conversations. *Secondhand, unconfirmed*

### Productboard Spark

- **Shape:** a set of dedicated agents for feedback analysis, spec writing, competitor research and codebase understanding. *Official ([Spark launch](https://www.productboard.com/blog/introducing-spark-agentic-product-system/))*
- **Feedback analysis:** takes in feedback from many channels, finds themes, links them to features and roadmaps; claims analysis of the whole feedback body "citations included." Needs "sufficient customer feedback captured." *Official*
- **How it runs a task:** skills apply automatically when relevant or are started with a slash command. Multi-step skills show progress; "You can't skip steps or reorder them." Scripts run in a sandbox and don't change the workspace directly. *Official ([Agentic skills](https://support.productboard.com/hc/en-us/articles/51202982788755-Agentic-skills-with-Spark))*
- **Handling gaps:** when writing a spec, missing context becomes a `[TBD]` placeholder rather than invented content; open questions get an owner (PM, Eng, Design, Legal, Data) and Spark asks them one at a time. *Official*
- **Safety on writes:** saving a spec uses "collision handling to prevent silent overwrites"; skills have version history and rollback. *Official*
- **Positioning:** "always keeping you in the driver seat." *Official*
- **Earlier:** Pulse (2024) for trends and themes; Insight Automation (2022) sends feedback to the right teams. *Secondhand*

### Jira Service Management (Atlassian)

**Virtual service agent (employee-facing):**
- **Answers** from linked knowledge base spaces using generative AI. Admins choose pages; Atlassian advises a few current, curated pages over whole spaces, because stale pages are a common cause of wrong answers. *Official / secondhand ([Atlassian blog](https://www.atlassian.com/blog/jira-service-management/rovo-agents-service-desk-instant-resolution), [Atlas Bench](https://www.atlas-bench.com/blog/how-rovo-agents-are-transforming-jira-service-management-in-2026))*
- **Escalation:** a built-in "Escalate" flow notifies the person and creates a request with a default request type, which can be changed during the conversation. Reported to carry the conversation into the ticket so the person doesn't repeat themselves. *Official (guide summary) / secondhand*
- **Raising requests:** Rovo agents create structured requests from conversations using real request types and forms. *Secondhand*
- **Admin control:** written instructions define role, scope, escalation triggers and limits; an org-wide inventory shows every agent, who built it and how often it is used. *Secondhand*
- **Limits:** metered "assisted conversations" with a usage limit and paid extra; Premium and Enterprise plans. *Official (doc titles) / secondhand*

**Request Router, formerly Service Triage agent (staff-facing):**
- **Reads:** summary, description, comments, customer sentiment, SLAs, past similar items. *Official ([Atlassian support](https://support.atlassian.com/rovo/docs/work-with-service-triage-agent/))*
- **Suggests:** priority, request type, escalation. **Acts:** can update the request type and add a summary as a comment. **Drafts:** replies for a person to use or edit. *Official*
- **Automation mode:** its output can drive automation rules that update fields. *Official*
- **Learning:** "continuously learns from past similar work items"; thumbs up or down on each suggestion. Atlassian recommends reviewing its suggestions regularly. *Official*

### ServiceNow AI Agents and Virtual Agent

- **Oversight model:** "human on the loop": people watch and step in when needed. A person can review an agent-made plan and approve it "before execution or changes." During a run the agent can ask the user for permission to continue and change course from the answer. *Official ([community FAQ](https://www.servicenow.com/community/servicenow-otto-articles/ai-agents-faq-and-troubleshooting/ta-p/3200454))*
- **Triggers:** a condition or objective, a database change, or a user's question. *Official*
- **Tools:** fewer than 15 per use case recommended; data passed between tools goes through the LLM and "may change," so instruct agents to pass data exactly. *Official*
- **Audit:** every run is stored as an execution plan with its steps; a test panel shows each step. *Official*
- **Guardrails:** prompt-injection protection (Now Assist Guardian); grounded prompts; semantic filters that move a conversation to a live agent when a sensitive topic is detected; a cap on repeated calls to the same tool. *Official / white paper*
- **Testing:** an evaluation tool runs an agent against 20 to 100 representative historical records and scores task completeness, tool-calling correctness and faithfulness. *Official*
- **Honest warnings in its docs:** "hallucinations are a possibility"; agents are "non-deterministic," so the same input can give different results. *Official*
- **Permissions:** reported that agents run under the same permissions as people, seeing only records their roles allow. *Secondhand ([metaCTO](https://www.metacto.com/technologies/servicenow))*
- **Approvals:** by email, Virtual Agent or mobile. *Official ([request management](https://www.servicenow.com/products/request-management.html))*

### Moveworks

- **Reasoning loop:** reads the goal, plans, runs plugins, checks the result, adjusts. It is not "programmed to follow a sequence of steps." *Official ([Moveworks docs](https://docs.moveworks.com/ai-assistant/introduction-to-assistant))*
- **Plugins:** conversational plugins run during a chat; ambient plugins run in the background on system events or schedules and can message people. *Official*
- **Stops early:** runs shortlisted plugins one at a time and returns the first helpful result; it does not combine results from several plugins (a stated limitation). *Official*
- **Clarifies** vague or incomplete requests through questions or from system data. *Official*
- **Handoff:** filing tickets and reaching live agents happen in a separate reference pane, not in the chat text. *Official*
- **Trust:** grounding; citations beside summaries; admins steer tone and policy and can deny content to certain groups. *Official*
- **Not documented on the page:** how it confirms actions before running them, and runtime permissions. *Unconfirmed*

### Freshworks Freddy

- **Auto Triage, per field:** Priority, Group, Type and custom dropdowns. Each field is set to Manual ("Freddy provides a suggestion, but the agent must click Apply") or Automatic (applied when the ticket is created). Automation rules override it. *Official ([Freshdesk setup](https://support.freshdesk.com/support/solutions/articles/50000002117-setting-up-auto-triage))*
- **Readiness:** needs about 2,000 historical tickets; a field shows "Insufficient Data" until it has enough, rechecked every 2 days. *Official*
- **Corrections:** staff accept, ignore or reject each suggestion; rejections are tracked. No confidence threshold or per-field accuracy figure is documented. *Official*
- **Self-service agent:** in Teams, Slack and the employee portal; claims up to 80 % of common queries resolved without staff. *Vendor claim*
- **Caveat raised by reviewers:** triage repeats any inconsistency already in the categories "at speed"; deflection depends on an accurate knowledge base. *Secondhand ([KlickFlow](https://klickflow.io/freshservice-freddy-ai-2026/))*

### Intercom Fin

- **Default escalation:** when the person asks for a human; on strong frustration (it may try once more first); after a loop of three turns where the person repeats themselves. *Official ([escalation guidance and rules](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules))*
- **Offer before escalating:** in unclear cases Fin offers a person in text; it never makes two offers in a row. *Official*
- **Two admin controls:** escalation rules on data (sentiment, issue type, customer attributes), and escalation guidance in plain language (escalate now, offer, ask follow-up questions first, or don't escalate). Fin can explain why it is or isn't escalating. *Official*
- **Ask for input (beta):** Fin holds its draft, a teammate reviews it and what Fin needs, then Fin replies; after a time limit Fin can send its draft. *Official*
- **Procedures:** steps written in plain language like training a new staff member; Fin can jump between steps when the person changes topic; if/else conditions in plain language or Python for strict rules; actions through connectors run one at a time, each finishing before the next. *Official ([Procedures](https://www.intercom.com/help/en/articles/12495167-fin-procedures-explained))*
- **Testing:** simulations: an AI plays the customer, holds a full conversation and scores pass or fail against success criteria, rerun after each change to catch regressions. *Official*
- **No human available:** Fin doesn't offer escalation and ends with a "get more help" outcome. *Official*
- **Not documented:** what context passes to the person on handoff. *Unconfirmed*

### Zendesk AI agents

- **Intelligent triage:** classifies each new ticket by intent, sentiment and language; tickets from before it was turned on are not classified. *Secondhand ([eesel](https://www.eesel.ai/blog/zendesk-advanced-ai-use-cases))*
- **Autonomous agents:** use knowledge, business rules and connected systems to act; ask follow-up questions; complete approved actions; hand off "with context intact." *Official ([Zendesk blog](https://www.zendesk.com/blog/zendesk-insights/innovation/relate-2025-resolution-platform-ai-agents/))*
- **Billing on outcomes:** charged per verified resolution rather than per seat. *Secondhand ([CMSWire](https://www.cmswire.com/customer-experience/zendesk-unveils-autonomous-ai-workforce-at-relate-2026/)); figures conflict*
- **Self-designed procedures:** announced, not confirmed shipped. *Unconfirmed*

## 2. Behaviour compared

| Behaviour | What the products do |
| --- | --- |
| **How much it does alone** | A per-feature dial is common: Featurebase (Off, Assisted, Automatic), Freddy (Manual or Automatic per field), Canny (reported auto or approve). The rest default to suggesting (JSM Request Router) or to acting with a person watching (ServiceNow). |
| **Duplicates** | Suggest and let a person merge, or merge only "clear" ones automatically and queue uncertain ones (Featurebase). Every product that merges also lets you undo or unmerge. |
| **Asking the person questions** | Fin, Zendesk and Moveworks ask follow-up questions when information is missing; Canny's Smart Replies ask customers automatically; Spark asks open questions one at a time and writes `[TBD]` instead of inventing. |
| **When it hands over** | Explicit request for a person, frustration, a loop, a sensitive topic (ServiceNow filters), a data rule (Fin), or the agent can't resolve it (JSM). Admins can override defaults in plain language (Fin, JSM). |
| **What passes on handoff** | JSM and Zendesk say the conversation travels into the ticket. Intercom and Moveworks don't document it. |
| **Confirming before acting** | ServiceNow: plan approval before execution and permission prompts mid-run. Fin: a teammate can review its draft. Others don't document a confirm step. |
| **Grounding and citations** | Answers from curated knowledge (JSM, Moveworks, ServiceNow); citations shown (Moveworks, Productboard). JSM warns that stale knowledge is the main cause of wrong answers. |
| **Permissions** | ServiceNow agents reportedly inherit the user's roles. Moveworks uses deny-lists by group. Others don't document runtime permissions. |
| **Audit and undo** | Canny: full log and undo. ServiceNow: stored execution plans and steps. Featurebase: unmerge and unlink. |
| **Learning from corrections** | JSM (learns from past items, thumbs up or down), Freddy (accept, ignore, reject tracked), Canny ("learns about your product"). None documents how corrections change the model. |
| **Testing before launch** | Intercom simulations with pass or fail; ServiceNow evaluation on 20 to 100 historical records scoring completeness, tool use and faithfulness. |
| **Readiness thresholds** | Freddy needs about 2,000 tickets per field; Spark needs "sufficient" feedback. |
| **Cost control** | Metered conversations (JSM), assists (ServiceNow), per resolution (Zendesk, Fin procedure handoffs), plan gating (most). |
| **Data use** | Canny states it doesn't train on customer data. |

## 3. Patterns across the products

Observations only; no recommendation.

1. **Autonomy is a setting, not a fixed choice.** The more mature products let an admin choose suggest or apply per field or per action, and start in suggest mode.
2. **Confidence splits the work.** Clear cases are automated; uncertain ones go to a person's queue (Featurebase duplicates, Freddy fields).
3. **Escalation is designed, not left to chance.** Fin has the most explicit rules: default triggers, offers before escalating, data rules, plain-language guidance, and a stated reason.
4. **Not inventing is a stated behaviour.** Spark writes `[TBD]` and assigns open questions; ServiceNow's docs warn openly about hallucination and non-determinism.
5. **Every automatic action can be seen and reversed.** Audit logs, execution records, undo and unmerge appear wherever the agent acts on its own.
6. **Agents are tested like software.** Simulations and evaluation sets with pass or fail scores run before launch and after each change.
7. **Knowledge quality limits the agent.** JSM and Freddy reviewers both say a stale or inconsistent knowledge base or category list is the main cause of poor results.
8. **Agents work across channels and in the background.** Canny and Featurebase pull feedback from support and sales tools without anyone submitting it; Moveworks' ambient plugins act on events.
9. **Pricing follows outcomes or usage**, not seats, for the agent part.

## 4. Non-agent features seen (from the first pass)

Kept short; details and sources were in the first pass.

- **Intake:** voting, voting on behalf of a customer, tags and categories, internal comments, board privacy (Canny); dynamic forms and mobile submission (JSM).
- **Status:** email on status change (Canny); roadmaps with date estimates (Canny, Productboard); delivery progress linked to engineering tickets (Jira Product Discovery).
- **Release notes:** changelog with scheduled releases and an in-product widget (Canny, Featurebase).
- **Prioritisation:** scoring formulas such as RICE (Jira Product Discovery, Productboard); sort by revenue impact and user segment (Canny).
- **Approvals:** approval steps in workflows (JSM); approval by email, chat or mobile (ServiceNow); reminders and required decline reasons (a third-party JSM app).
- **Security:** SSO, role-based access, audit logs, SOC 2 (Productboard, Canny).

## 5. Gaps in this research

- No product documents what exactly passes to a person on handoff, except as a general claim.
- Confirm-before-acting behaviour is documented only for ServiceNow and Intercom's "Ask for input."
- Runtime permissions are documented only secondhand (ServiceNow).
- Atlassian's virtual service agent pages could not be read in full; parts come from summaries.
- Zendesk and Fibi details are mostly secondhand.
- No independent accuracy figures for any agent were found.

## Sources

Official:
- [Canny Autopilot](https://canny.io/features/autopilot)
- [Featurebase: Feedback 2.0 and Autopilot levels](https://help.featurebase.app/en/articles/6686694-feedback-20-whats-changed-for-existing-users)
- [Featurebase changelog](https://feedback.featurebase.app/changelog)
- [Productboard Spark launch](https://www.productboard.com/blog/introducing-spark-agentic-product-system/)
- [Productboard: Agentic skills with Spark](https://support.productboard.com/hc/en-us/articles/51202982788755-Agentic-skills-with-Spark)
- [Productboard Spark feedback analysis](https://www.productboard.com/blog/productboard-spark-ai-customer-feedback-analysis/)
- [Atlassian: Request Router (Service Triage agent)](https://support.atlassian.com/rovo/docs/work-with-service-triage-agent/)
- [Atlassian blog: Rovo agents in the service desk](https://www.atlassian.com/blog/jira-service-management/rovo-agents-service-desk-instant-resolution)
- [ServiceNow community: AI Agents FAQ](https://www.servicenow.com/community/servicenow-otto-articles/ai-agents-faq-and-troubleshooting/ta-p/3200454)
- [ServiceNow: Now Assist governance white paper](https://www.servicenow.com/community/s/cgfwn76974/attachments/cgfwn76974/now-assist-blog/83/1/White_Paper_Now_Assist_Governance_Tools_and_Guardrails.pdf)
- [ServiceNow request management](https://www.servicenow.com/products/request-management.html)
- [Moveworks Assistant overview](https://docs.moveworks.com/ai-assistant/introduction-to-assistant)
- [Freshdesk: Auto Triage setup](https://support.freshdesk.com/support/solutions/articles/50000002117-setting-up-auto-triage)
- [Freshservice Freddy AI](https://www.freshworks.com/freshservice/ai-itsm/)
- [Intercom: Fin escalation guidance and rules](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules)
- [Intercom: Fin Procedures](https://www.intercom.com/help/en/articles/12495167-fin-procedures-explained)
- [Zendesk: Resolution Platform](https://www.zendesk.com/blog/zendesk-insights/innovation/relate-2025-resolution-platform-ai-agents/)

Secondhand:
- [Formbricks: Canny vs Productboard vs Featurebase](https://formbricks.com/blog/canny-vs-productboard-vs-featurebase)
- [Atlas Bench: Rovo agents in JSM 2026](https://www.atlas-bench.com/blog/how-rovo-agents-are-transforming-jira-service-management-in-2026)
- [metaCTO: ServiceNow AI](https://www.metacto.com/technologies/servicenow)
- [KlickFlow: Freshservice Freddy 2026](https://klickflow.io/freshservice-freddy-ai-2026/)
- [eesel: Zendesk advanced AI](https://www.eesel.ai/blog/zendesk-advanced-ai-use-cases)
- [CMSWire: Zendesk Relate 2026](https://www.cmswire.com/customer-experience/zendesk-unveils-autonomous-ai-workforce-at-relate-2026/)
