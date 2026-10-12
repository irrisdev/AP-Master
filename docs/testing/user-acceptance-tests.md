# User acceptance test script

**How to run:** start the app (see the README) with a real AI key, open the customer chat and the
staff dashboard in two browser windows, and work through each case as a customer or agent would.
Record what actually happened, not what should have happened.

**Testers** should include at least one person who did not build the system.

| Field | Value |
|---|---|
| Build / commit | |
| Date | |
| Tester(s) | |
| AI provider and model | |

| # | Story | Steps | Expected result | Actual result | Pass? |
|---|---|---|---|---|---|
| 1 | 1 | As a customer, ask "What broadband packages do you offer?" | A relevant, polite answer within a few seconds. No ticket is created. | | |
| 2 | 1 | Follow up with "How much is the fastest one?" | The answer uses the previous reply as context and doesn't ask what "the fastest one" means. | | |
| 3 | 1 | Ask "Can you fix my boiler?" | Politely declines as outside Telegroup's services. No ticket is created. | | |
| 4 | 2 | Say "My router won't turn on, I need an engineer". | Acknowledges the problem, quotes a `TKT-` reference, and says a technician will contact you. | | |
| 5 | 2 | With the staff dashboard open, repeat case 4 as a different customer. | The ticket appears on the dashboard without a refresh (needs Part 2 of the frontend handoff), with the full chat transcript. | | |
| 6 | 2 | As staff, move that ticket to In progress, then Resolved, then Closed. Then try to reopen it. | Each change is saved. Reopening is refused with a clear message. | | |
| 7 | 3 | As a customer, say "My internet keeps dropping out". | Numbered troubleshooting steps, ending with "Did that fix the problem?". | | |
| 8 | 3 | Reply "No, it's still not working". | A `TKT-` reference, and a statement that a technician has the details. The ticket's description contains the whole problem, not just "still not working". | | |
| 9 | 3 | Repeat case 7 in a new chat, then reply "Yes that fixed it". | A friendly close. No ticket is created. | | |
| 10 | 4 | Say "I want to make a complaint". | The assistant asks what happened before logging anything. | | |
| 11 | 4 | Reply "I was charged twice this month and want a refund". | An apology and a `CMP-` reference. On the dashboard the complaint shows category Billing and severity Medium. | | |
| 12 | 4 | In a new chat, complain mentioning "legal action". | The reply says the complaint was escalated to a senior member of staff. On the dashboard it shows severity High and escalated. | | |

## Non-functional checks

| # | Check | Expected | Actual | Pass? |
|---|---|---|---|---|
| N1 | Send 20 messages as fast as possible in one chat. | After 15, a "sending too quickly" message appears. Nothing crashes. | | |
| N2 | Disconnect the network (or remove the AI key) and ask a question. | A polite fallback reply rather than an error page. | | |
| N3 | Use the chat on a phone-sized screen. | Everything is readable and usable without horizontal scrolling. | | |
| N4 | Navigate the chat with the keyboard only. | All controls can be reached and the focus is visible. | | |

## Findings

| # | Case | Issue | Severity | Action |
|---|---|---|---|---|
| | | | | |
