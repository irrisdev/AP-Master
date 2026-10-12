# User story alignment

How the artefact stands against the seven user stories, as of 12 October 2026. This review covers
`master` plus the server work on `feature/technical-hardening`. Each verdict comes from reading the
code and running it:
- Both test suites pass: server **133/133**, client **124/124**.
- The Docker image was built and run.
- A load test was recorded.

The previous review, from 30 September, is kept as the baseline in the "Was" column.

Legend:
- **Met**: the acceptance criterion passes end to end.
- **Partial**: the mechanism exists, but at least one clause of the AC does not hold.
- **Not met**: nothing implements the clause yet.

| #   | Story              | Importance | Points | Was     | Now     | Remaining gap                                                                            |
| --- | ------------------ | ---------- | ------ | ------- | ------- | ---------------------------------------------------------------------------------------- |
| 1   | Customer Enquiries | Must       | 3      | Met     | **Met** | None on the server                                                                       |
| 2   | Technical Support  | Must       | 2      | Met     | **Met** | Real-time push exists on the server; the dashboard doesn't subscribe yet                 |
| 3   | Service Issues     | Must       | 3      | Met     | **Met** | Confirmation is free text only (quick-reply buttons would help)                          |
| 4   | Complaints Logging | Must       | 1      | Partial | Partial | The session is not ended; no authentication; client not yet updated for the ticket merge |
| 5   | Architecture (IoC) | Should     | 5      | Met     | **Met** | None                                                                                     |
| 6   | System Concurrency | Could      | 5      | Partial | **Met** | In-process only (single server); stated in the load test                                 |
| 7   | Security & Quality | Must       | 5      | Partial | Partial | No authentication; acceptance tests written but not yet run; client handoff pending      |

What changed since the last review:
- Story 6 now has deliberate concurrency control (an AI concurrency limit, per-client rate limits
  and a per-conversation lock), measured in a [load test](docs/testing/load-test.md).
- Story 7 now has:
  - integration tests over HTTP and `ChatService` workflow tests
  - CI on every push
  - a README with run, test and architecture sections, plus APA references
  - a data-handling note
  - a working Docker image
  - the database removed from version control
- Most of what remains is in the **client** ([docs/FRONTEND-HANDOFF.md](docs/FRONTEND-HANDOFF.md)),
  plus story 4's "ends the session" and running the acceptance tests with real users.

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
- The placeholder AI (no key configured) now gives a neutral reply to enquiries. It only gives router
  advice when asked for troubleshooting steps.
- **Tested:** `ChatServiceTests.Enquiry_*` covers the AI answer, the history sent on a follow-up, and
  the fallback when the AI is down. `ApiTests.Chat_ConversationIsPersistedAndReadable` covers
  persistence.

## 2. Technical Support: Met

> Given a live chat, when the intent is a 'technical support request', then the system
> immediately connects to a human.

**What holds**

- A technical-support message raises a `SupportTicket` (`Type = TechnicalSupport`) in the same
  request, sets the conversation to `Escalated`, and quotes the ticket reference in the reply.
- Duplicates are prevented, both sequentially (an open ticket is reused) and under concurrency
  (`ConversationLocks`; see story 6).
- **Staff are notified the moment it happens.** `TicketService` broadcasts `TicketCreated` and
  `TicketUpdated` over SignalR on `/hubs/staff` (`StaffHubTests`). This makes "immediately connects"
  literal on the server side.
- Staff API: list and filter, read, change status, close and escalate. A 409 is returned when a
  closed ticket is reopened or a ticket is escalated twice.
- **Tested:** `ChatServiceTests.TechnicalSupport_*`, `ApiTests.Chat_TechnicalSupport_*`,
  `ApiTests.Ticket_*` and `StaffHubTests`.

**Loose ends**

- The dashboard doesn't subscribe to the hub yet, so it still needs a refresh. That is a small client
  change (Part 2 of the frontend handoff).
- The client chat notice shows `#id` rather than the reference.

## 3. Service Issues: Met

> Given a reported service issue, when the AI provides troubleshooting steps, then it must
> prompt the user to confirm resolution, transferring to a human technician if answered "No".

**What holds**

- Numbered steps ending with "Did that fix the problem?", and the conversation moves to
  `Troubleshooting`. If the customer hasn't said what's wrong, the AI asks first (`[NEED_DETAILS]`).
- The next message is judged by `TroubleshootingOutcomeDetector`, which checks negatives first.
  - "No" raises a `ServiceIssue` ticket containing the customer's whole side of the conversation.
  - "Yes" resolves the conversation.
  - If the AI can't produce steps at all, the customer goes straight to a ticket.
- **Tested:** `ChatServiceTests.ServiceIssue_*` (the steps and prompt, No → ticket, Yes → resolved,
  missing details asked for, AI down → ticket) and `TroubleshootingOutcomeDetectorTests`. This closes
  the previous review's "no server test covers the state machine".

**Loose ends**

- Quick-reply "Yes, it's fixed" / "No, still broken" buttons (client only) would make the prompt
  obvious and avoid `Unclear` answers.

## 4. Complaints Logging: Partial

> Given a complaint request, when details are collected, then the system securely writes
> data to the database, assigns an official ticket number, displays it, and ends the session.

**What holds**

- **Details are collected.** "I want to make a complaint" gets a question about what happened, and
  the next message becomes the complaint (`ComplaintDetails`).
- **Written to the database** as a `SupportTicket` with `Type = Complaint`, status `Open`, and a
  rule-based category and severity. High severity is escalated automatically.
- **Official number:** `CMP-` plus eight hex characters, with a unique index. The number is shown in
  the chat, and the response carries the `ticketId`.
- **More secure than before:**
  - ownership checks
  - rate limiting
  - security headers
  - restricted CORS
  - errors that never leak internals
- **Tested:** `ChatServiceTests.Complaint_*`, `TicketServiceTests` (severity and category rules) and
  `ApiTests.Chat_Complaint_IsListedAsAComplaintTicket`.

**What does not**

- "Ends the session": the conversation stays open after the complaint is logged.
- "Securely": there is no authentication, so the `customerId` in the request body is trusted. The
  README now states this boundary explicitly.
- The client still calls the removed `/api/complaints`, so the complaints dashboard returns 404 in
  live mode, and complaints are labelled as support tickets in the chat. See
  [docs/FRONTEND-HANDOFF.md](docs/FRONTEND-HANDOFF.md), Part 1.

**To close**

1. Client: apply Part 1 of the frontend handoff.
2. Server: set the conversation to `Resolved` once a complaint is logged, and return the status (or
   an `ended` flag) in `ChatResponse`.
3. Client: when the conversation has ended, disable the composer and offer "Start a new conversation".

## 5. Architecture (IoC): Met

> Given the system's reliance on external AI model, when the application instantiates, then
> the AI API is injected via an interface.

**What holds**

- `ChatService` and `ClassificationService` depend only on `IAIService`. `AddAIServices` chooses the
  real provider or the placeholder at start-up. Either way it is wrapped in
  `ConcurrencyLimitedAIService`, a **decorator** that adds the concurrency limit without either
  implementation knowing. That is IoC doing visible work.
- Every service sits behind an interface. `ITicketNotifier` is the same idea: `TicketService` raises
  events without knowing about SignalR, and tests substitute a recorder.
- **Demonstrated by tests:**
  - `ClassificationServiceTests` injects a fake AI.
  - `TelegroupApiFactory` replaces the AI provider through the container for the whole running app.
  - `ConcurrencyLimitedAIServiceTests` exercises the decorator on its own.

## 6. System Concurrency: Met

> Given massive spikes in concurrent users, when processing messages, then threads are
> handled asynchronously.

**What holds**

- **Asynchronous throughout**, with cancellation passed through every layer. In the load test,
  40 simultaneous customers needing 46 s of AI time in total were served in 1.9 s of wall-clock time.
- **Deliberate control**, as the rubric asks:
  1. **AI concurrency limit.** `AIRequestGate` wraps a shared `SemaphoreSlim` and limits AI calls to
     `AI:MaxConcurrentRequests`. Callers that can't get a slot within `AI:QueueTimeoutSeconds` use
     their fallback reply rather than fail. Load test B: exactly 4 of 4 slots used, and all 40
     customers answered.
  2. **Per-client rate limiting.** Token buckets, partitioned by client IP, on the whole API and more
     tightly on chat. Excess requests get `429` with `Retry-After`. Load test D: 15 accepted and 15
     rejected.
  3. **Per-conversation serialisation.** `ConversationLocks` is a keyed async lock, cleaned up when
     unused. It stops two simultaneous messages both raising a ticket. The test for this fails with
     the lock removed (2 tickets) and passes with it (1).
  4. **Observability.** `/health` reports `Degraded` while every AI slot is busy.
- **Evidence:**
  - [load test](docs/testing/load-test.md) with four scenarios
  - `ConcurrencyTests`
  - `KeyedLockTests`
  - `ConcurrencyLimitedAIServiceTests`
  - `RateLimitingTests`

**Limits (stated in the load test)**

- The lock and the AI limit are in-process, so several server instances would need a shared store.
- SQLite allows one writer at a time.

## 7. Security & Quality: Partial

> Given a new feature push, when submitted for review, then inputs must be sanitised, code
> fully documented, and passing automated unit and integration tests must be evidenced.

**Inputs: holds**

- DataAnnotations on the request DTOs, plus service-level validation.
- Every error, including validation 400s and rate-limit 429s, is `application/problem+json` with a
  `traceId`. Unknown API routes return a JSON 404 instead of the SPA's page.
- Security headers on every response, HSTS outside development, CORS limited to configured origins,
  and per-client rate limits.

**Documentation: holds**

- XML doc comments across the server.
- The [README](README.md) covers:
  - an architecture diagram and design choices
  - how to run (locally and in Docker)
  - configuration and the API
  - the concurrency design
  - testing
  - security, and a **UK GDPR data-handling note**
  - **APA 7 references, with an AI-use statement** for the team to confirm
- Design artefacts: class diagram and database schema.
- Testing documents: [test strategy with traceability](docs/testing/test-strategy.md),
  [load test](docs/testing/load-test.md) and [acceptance test script](docs/testing/user-acceptance-tests.md).

**Automated tests: holds**

- Server: **133 passing**: 113 unit (workflows, ticket rules, classifier, concurrency primitives) and
  20 **integration** tests over HTTP with `WebApplicationFactory` (the real pipeline, database, rate
  limiting, SignalR). Coverage: **90.4 % of lines and 84.1 % of branches** on hand-written code.
- Client: **124 passing**, 85 % statement coverage.
- **CI** ([ci.yml](.github/workflows/ci.yml)) runs on every push and pull request. It:
  - builds and tests the server
  - lints, type-checks, builds and tests the client
  - builds the Docker image, starts it, and smoke-tests `/health`, the SPA and a chat message

**Still open**

- **Authentication.** None, by design for the prototype; the README states it plainly.
- **User acceptance testing.** The script is written. It still needs running with real testers and
  the results recording.
- **Client handoff.** The client hasn't been updated for the ticket merge, so there is a live-mode
  bug until it is (story 4).

---

## Cross-cutting issues

| Issue                                                                        | Stories | State                                                               |
| ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| No ownership check on `conversationId`                                       | 4, 7    | **Fixed**                                                           |
| Not-found surfaced as 500                                                    | 7       | **Fixed**                                                           |
| `traceId` missing from error responses                                       | 7       | **Fixed**                                                           |
| Enquiry prompt carries only the latest message                               | 1       | **Fixed**                                                           |
| Complaint logged without details                                             | 4       | **Fixed**                                                           |
| Unrelated requests became tickets or complaints                              | 2–4     | **Fixed**                                                           |
| Duplicate ticket in one conversation (sequential)                            | 2–4     | **Fixed**                                                           |
| Duplicate ticket when messages race in concurrently                          | 2–4, 6  | **Fixed**: `ConversationLocks`, with a test that proves the race    |
| Ticket reference differs between chat reply and dashboard                    | 2       | **Fixed**                                                           |
| Complaints and tickets modelled separately                                   | 2, 4    | **Fixed** on the server                                             |
| No deliberate concurrency control                                            | 6       | **Fixed**: AI limit, rate limits, keyed lock, load test             |
| No integration tests or `ChatService` tests                                  | 7       | **Fixed**                                                           |
| No CI                                                                        | 7       | **Fixed**: GitHub Actions                                           |
| README empty; no APA acknowledgements                                        | 7       | **Fixed** (the team should confirm the AI-use statement)            |
| Customer text sent to an external AI provider with no data note              | 7       | **Fixed**: README data-handling section                             |
| SQLite database tracked in git                                               | 7       | **Fixed** (removal staged, `*.db*` ignored)                         |
| Placeholder AI reply is router advice for every request type                 | 1       | **Fixed**                                                           |
| CORS allows any origin                                                       | 4, 7    | **Fixed**: configured origins only                                  |
| Docker image would start with no schema; Windows-only DB path                | 7       | **Fixed**: migrate on start-up, OS-independent path, image verified |
| Validation errors returned as `application/json`, not ProblemDetails         | 7       | **Fixed** (found by the new integration tests)                      |
| Unused `GlobalExceptionHandler`                                              | 7       | **Removed**                                                         |
| Client not updated for the ticket merge (complaints panel 404s in live mode) | 2, 4    | Open: [frontend handoff](docs/FRONTEND-HANDOFF.md) Part 1           |
| Dashboard doesn't use the SignalR feed                                       | 2       | Open: frontend handoff Part 2                                       |
| Chat notice shows `#id` rather than the reference                            | 2       | Open (client)                                                       |
| Conversation not ended after a complaint                                     | 4       | Open                                                                |
| No authentication                                                            | 4, 7    | Open (out of scope for the prototype; documented)                   |

## Suggested order

1. **Client: frontend handoff Part 1** (Oliver). Fixes the only live bug, and is needed before the demo.
2. **Run the acceptance test script** (both, plus at least one outside tester). Record the results in
   `docs/testing/user-acceptance-tests.md`.
3. **Story 4 end of session** (Donal: server status flag; Oliver: disable the composer). This is the
   last Must story that is Partial.
4. **Client: frontend handoff Part 2** (Oliver). Live ticket feed on the dashboard, and 429 handling
   in the chat.
5. **Polish:** the reference in the chat notice, and quick replies after troubleshooting.
