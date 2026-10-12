# User story alignment

How the artefact stands against the seven user stories, as of 12 October 2026. This review covers
`master` plus `feature/improvements` (server) and `feature/frontend-ticket-merge` (client).
Each verdict comes from reading the code and running it:
- Both test suites pass: server **139/139**, client **151/151**.
- The app was exercised end to end in a browser against the real API, including the live
  SignalR feed.
- The Docker image was built and run, and a load test was recorded.

The previous review, from earlier on 12 October, is kept as the baseline in the "Was" column.

Legend:
- **Met**: the acceptance criterion passes end to end.
- **Partial**: the mechanism exists, but at least one clause of the AC does not hold.
- **Not met**: nothing implements the clause yet.

| #   | Story              | Importance | Points | Was     | Now     | Remaining gap                                                               |
| --- | ------------------ | ---------- | ------ | ------- | ------- | --------------------------------------------------------------------------- |
| 1   | Customer Enquiries | Must       | 3      | Met     | **Met** | None                                                                        |
| 2   | Technical Support  | Must       | 2      | Met     | **Met** | None: new tickets reach the dashboard live                                  |
| 3   | Service Issues     | Must       | 3      | Met     | **Met** | None: Yes/No quick replies added                                            |
| 4   | Complaints Logging | Must       | 1      | Partial | **Met** | "Securely" rests on ownership checks, not sign-in (documented)              |
| 5   | Architecture (IoC) | Should     | 5      | Met     | **Met** | None                                                                        |
| 6   | System Concurrency | Could      | 5      | Met     | **Met** | In-process only (single server); stated in the load test                    |
| 7   | Security & Quality | Must       | 5      | Partial | Partial | No authentication; acceptance tests written but not yet run with real users |

What changed since the last review:
- **The client has caught up with the server.** Complaints are tickets throughout. The dashboard is
  one live ticket queue with type, status, severity, escalation and customer filters, a queue summary,
  and a detail panel showing the conversation that raised each ticket.
- **Story 4 is now Met:**
  - Logging a complaint ends the session. The server marks the conversation `Closed` and refuses
    further messages with a 409.
  - The chat replaces the composer with "Start a new conversation".
- **Chat polish:**
  - Notices quote the real reference, appear once per ticket and promise no timescales.
  - Yes/No quick replies after troubleshooting.
  - A visible cooldown after a 429.
  - A reopened conversation shows where its ticket has got to.
  - Example openers in an empty chat.
- **A routing bug found and fixed.** Complaint details that mentioned an engineer, a router or a
  dropping connection were being routed as a new support request instead of being logged as the
  complaint. It is fixed on the server and in the mock, with tests.

---

## 1. Customer Enquiries: Met

> Given a customer chat session, when the intent is classified as a 'general enquiry', then
> the AI model API generates and returns a contextual response entirely within the GUI.

**What holds**

- Classification is a hybrid. `RuleBasedClassifier` scores weighted phrases and decides when its
  confidence is ≥ 0.6. Otherwise `ClassificationService` asks the AI. It accepts the answer only if
  it names exactly one known category, and falls back to the rules if the AI fails. Follow-ups are
  classified against the current topic.
- Contextual: every AI call sends the stored conversation, up to 20 messages or 12,000 characters
  ([AIChatHistory.cs](AP-Master.Server/Services/AIChatHistory.cs)).
- `AIService` calls a real OpenAI-compatible endpoint (OpenRouter). Timeouts, HTTP errors, bad JSON
  and empty responses all map to `AIServiceException`.
- Graceful degradation: any AI failure, including a saturated AI limit, becomes a fixed apology
  instead of a 500.
- Scope: unrelated requests get a polite refusal through the `[OUT_OF_SCOPE]` marker.
- In the GUI, an empty chat offers one example opener per thing the assistant can do, and each reply
  is labelled with how it was triaged.
- **Tested:** `ChatServiceTests.Enquiry_*` covers the AI answer, the history sent on a follow-up, and
  the fallback when the AI is down. `ApiTests.Chat_ConversationIsPersistedAndReadable` covers
  persistence. `ChatView.test.tsx` covers the reply, the triage label and the openers.

## 2. Technical Support: Met

> Given a live chat, when the intent is a 'technical support request', then the system
> immediately connects to a human.

**What holds**

- A technical-support message raises a `SupportTicket` (`Type = TechnicalSupport`) in the same
  request, sets the conversation to `Escalated`, and returns the ticket's reference in `ChatResponse`.
  The chat shows "Support ticket TKT-… raised" once, however many follow-ups mention it.
- Duplicates are prevented, both sequentially (an open ticket is reused) and under concurrency
  (`ConversationLocks`; see story 6).
- **Staff see it immediately.**
  - `TicketService` broadcasts `TicketCreated` and `TicketUpdated` over SignalR on `/hubs/staff`.
  - The dashboard subscribes, so a new ticket appears in the queue as it is raised. It is
    highlighted, announced to screen readers, and counted in the queue summary.
  - A "Live" indicator shows the connection state, and the queue reloads after a reconnect.
  - Verified in the browser against the real server.
- Staff workflow:
  - Status buttons that fit the ticket's type, close, and escalate to senior staff.
  - The customer's name, and the full conversation transcript, beside the ticket.
  - A 409 when a closed ticket is reopened or a ticket is escalated twice.
- **Tested:**
  - Server: `ChatServiceTests.TechnicalSupport_*`, `ApiTests.Chat_TechnicalSupport_*`,
    `ApiTests.Ticket_*` and `StaffHubTests`.
  - Client: `TicketsPanel.test.tsx` (live arrival, filtering, escalation, transcript) and
    `ChatView.test.tsx` (one notice per ticket).

## 3. Service Issues: Met

> Given a reported service issue, when the AI provides troubleshooting steps, then it must
> prompt the user to confirm resolution, transferring to a human technician if answered "No".

**What holds**

- Numbered steps ending with "Did that fix the problem?", and the conversation moves to
  `Troubleshooting`. If the customer hasn't said what's wrong, the AI asks first (`[NEED_DETAILS]`).
- **The prompt is a real choice in the GUI.** "Yes, that fixed it" and "No, it's still not working"
  quick replies appear under the steps, so the customer doesn't have to guess what to type.
- The next message is judged by `TroubleshootingOutcomeDetector`, which checks negatives first.
  - "No" raises a `ServiceIssue` ticket containing the customer's whole side of the conversation.
  - "Yes" resolves the conversation.
  - If the AI can't produce steps at all, the customer goes straight to a ticket.
- **Tested:**
  - Server: `ChatServiceTests.ServiceIssue_*` and `TroubleshootingOutcomeDetectorTests`.
  - Client: `ChatView.test.tsx` (the quick replies: "No" raises a ticket, "Yes" closes the loop).

## 4. Complaints Logging: Met

> Given a complaint request, when details are collected, then the system securely writes
> data to the database, assigns an official ticket number, displays it, and ends the session.

**What holds**

- **Details are collected.** "I want to make a complaint" gets a question about what happened, and
  the next message becomes the complaint, even if it mentions an engineer or a fault (this was a bug,
  now fixed). A clear question ("actually, what are your prices?") is still answered instead.
- **Written to the database** as a `SupportTicket` with `Type = Complaint`, status `Open`, and a
  rule-based category and severity. High severity is escalated automatically.
- **Official number:** `CMP-` plus eight hex characters, with a unique index.
- **Displayed:** the number appears in the reply and in a "Complaint CMP-… logged" notice (with
  "and escalated" when it was). Staff see the complaint in the queue, with its severity.
- **The session ends.**
  - The server marks the conversation `Closed`, returns that status in `ChatResponse`, and refuses
    further messages with a 409.
  - The chat replaces the composer with "This conversation has ended" and a "Start a new
    conversation" button.
- **Securely, within a stated boundary:**
  - Input validation.
  - Ownership checks: another customer's conversation reads as "not found".
  - Rate limiting, security headers and restricted CORS.
  - Errors that never leak internals.
  - There is no sign-in, so the customer ID is trusted. The README states this as a prototype
    boundary.
- **Tested:**
  - Server: `ChatServiceTests.Complaint_*` (including details that mention a fault, a change of
    mind, and the session ending), `EndedConversation_RefusesFurtherMessages_*`,
    `ApiTests.Chat_AfterAComplaintIsLogged_TheConversationIsClosed` and `TicketServiceTests`.
  - Client: `ChatView.test.tsx` (the session ending and starting a fresh one).

## 5. Architecture (IoC): Met

> Given the system's reliance on external AI model, when the application instantiates, then
> the AI API is injected via an interface.

**What holds**

- `ChatService` and `ClassificationService` depend only on `IAIService`. `AddAIServices` chooses the
  real provider or the placeholder at start-up. Either way it is wrapped in
  `ConcurrencyLimitedAIService`, a **decorator** that adds the concurrency limit without either
  implementation knowing.
- Every service sits behind an interface. `ITicketNotifier` lets `TicketService` raise events without
  knowing about SignalR.
- The client mirrors this. Components depend on the `ApiClient` interface, and the live ticket feed is
  part of it (`subscribeToTickets`):
  - `HttpApiClient` implements it with SignalR.
  - `MockApiClient` implements it with in-memory events.

  The dashboard code is the same in both modes.
- **Demonstrated by tests:**
  - `ClassificationServiceTests` injects a fake AI.
  - `TelegroupApiFactory` replaces the AI provider for the whole running app.
  - `ConcurrencyLimitedAIServiceTests` exercises the decorator.
  - Client tests inject their own `ApiClient`.

## 6. System Concurrency: Met

> Given massive spikes in concurrent users, when processing messages, then threads are
> handled asynchronously.

**What holds**

- **Asynchronous throughout**, with cancellation passed through every layer. In the load test,
  40 simultaneous customers needing 46 s of AI time in total were served in 1.9 s of wall-clock time.
- **Deliberate control:**
  1. **AI concurrency limit.** `AIRequestGate` limits AI calls with a shared `SemaphoreSlim`. Callers
     that can't get a slot in time use their fallback reply. Load test B: exactly 4 of 4 slots used,
     and all 40 customers answered.
  2. **Per-client rate limiting.** Excess requests get `429` with `Retry-After`. Load test D: 15
     accepted and 15 rejected. The chat now turns a 429 into a visible cooldown: "You can send again
     in N seconds".
  3. **Per-conversation serialisation.** `ConversationLocks` stops two simultaneous messages both
     raising a ticket. The test fails with the lock removed (2 tickets) and passes with it (1).
  4. **Observability.** `/health` reports `Degraded` while every AI slot is busy.
- **Evidence:**
  - [load test](docs/testing/load-test.md)
  - `ConcurrencyTests`
  - `KeyedLockTests`
  - `ConcurrencyLimitedAIServiceTests`
  - `RateLimitingTests`
  - `ChatView.test.tsx` (the cooldown)

**Limits (stated in the load test)**

- The lock and the AI limit are in-process, so several server instances would need a shared store.
- SQLite allows one writer at a time.

## 7. Security & Quality: Partial

> Given a new feature push, when submitted for review, then inputs must be sanitised, code
> fully documented, and passing automated unit and integration tests must be evidenced.

**Inputs: holds**

- DataAnnotations on the request DTOs, plus service-level validation. The client checks the same
  limits before sending.
- Every error, including validation 400s and rate-limit 429s, is `application/problem+json` with a
  `traceId`, and the client shows that reference. Unknown API routes return a JSON 404.
- Security headers on every response, HSTS outside development, CORS limited to configured origins,
  and per-client rate limits.

**Documentation: holds**

- XML doc comments across the server, and comments at the seams on the client.
- The [README](README.md) covers:
  - architecture and design choices
  - how to run and test
  - configuration and the API
  - the concurrency design
  - security, with a UK GDPR note
  - APA 7 references, with an AI-use statement for the team to confirm
- Design artefacts: class diagram and database schema.
- Testing documents: [test strategy](docs/testing/test-strategy.md), [load test](docs/testing/load-test.md)
  and [acceptance test script](docs/testing/user-acceptance-tests.md).

**Automated tests: holds**

- Server: **139 passing**: 118 unit and 21 **integration** tests over HTTP with `WebApplicationFactory`.
  Coverage: **90.5 % of lines and 83.5 % of branches** on hand-written code.
- Client: **151 passing**, 86.4 % statement coverage. Lint and type-check are clean.
- **CI** ([ci.yml](.github/workflows/ci.yml)) runs on every push and pull request. It builds and tests
  both halves, then builds the Docker image and smoke-tests it.

**Still open**

- **Authentication.** None, by design for the prototype; the README states it plainly.
- **User acceptance testing.** The script is written. It still needs running with real testers and
  the results recording.

---

## Cross-cutting issues

| Issue                                                                      | Stories | State                                                               |
| -------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| No ownership check on `conversationId`                                     | 4, 7    | **Fixed**                                                           |
| Not-found surfaced as 500                                                  | 7       | **Fixed**                                                           |
| `traceId` missing from error responses                                     | 7       | **Fixed**                                                           |
| Enquiry prompt carries only the latest message                             | 1       | **Fixed**                                                           |
| Complaint logged without details                                           | 4       | **Fixed**                                                           |
| Complaint details mentioning a fault were routed as a new support ticket   | 2, 4    | **Fixed** (server and mock, with tests)                             |
| Unrelated requests became tickets or complaints                            | 2–4     | **Fixed**                                                           |
| Duplicate ticket in one conversation (sequential)                          | 2–4     | **Fixed**                                                           |
| Duplicate ticket when messages race in concurrently                        | 2–4, 6  | **Fixed**: `ConversationLocks`, with a test that proves the race    |
| Ticket reference differs between chat reply and dashboard                  | 2       | **Fixed**                                                           |
| Complaints and tickets modelled separately                                 | 2, 4    | **Fixed** on the server and the client                              |
| Client not updated for the ticket merge                                    | 2, 4    | **Fixed**: one ticket queue; complaints panel removed               |
| Dashboard needed a refresh to see new tickets                              | 2       | **Fixed**: SignalR feed, live indicator                             |
| Chat notice showed `#id`, repeated on follow-ups, and promised a timescale | 2, 4    | **Fixed**                                                           |
| Conversation not ended after a complaint                                   | 4       | **Fixed**                                                           |
| No deliberate concurrency control                                          | 6       | **Fixed**: AI limit, rate limits, keyed lock, load test             |
| No integration tests or `ChatService` tests                                | 7       | **Fixed**                                                           |
| No CI                                                                      | 7       | **Fixed**: GitHub Actions                                           |
| README empty; no APA acknowledgements                                      | 7       | **Fixed** (the team should confirm the AI-use statement)            |
| Customer text sent to an external AI provider with no data note            | 7       | **Fixed**: README data-handling section                             |
| SQLite database tracked in git                                             | 7       | **Fixed**                                                           |
| Placeholder AI reply is router advice for every request type               | 1       | **Fixed**                                                           |
| CORS allows any origin                                                     | 4, 7    | **Fixed**: configured origins only                                  |
| Docker image would start with no schema; Windows-only DB path              | 7       | **Fixed**: migrate on start-up, OS-independent path, image verified |
| Validation errors returned as `application/json`, not ProblemDetails       | 7       | **Fixed** (found by the new integration tests)                      |
| Dashboard filter fields stretched to full width                            | 2       | **Fixed** (CSS order issue)                                         |
| Unused `GlobalExceptionHandler`                                            | 7       | **Removed**                                                         |
| No authentication                                                          | 4, 7    | Open (out of scope for the prototype; documented)                   |

## Suggested order

1. **Run the acceptance test script** (both, plus at least one outside tester). Record the results in
   `docs/testing/user-acceptance-tests.md`. This is the main evidence still missing.
2. **Confirm the AI-use statement** in the README, so it accurately describes how the team used AI.
3. **Rehearse the demo** with a real AI key. Keep the placeholder mode ready as a fallback in case the
   network or provider fails on the day.
