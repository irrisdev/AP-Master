# User story alignment

How the artefact stands against the seven user stories, as of 12 October 2026 (master at
`89fea09`). Each verdict comes from reading the code and running it. Both test suites pass:
server **41/41**, client **124/124**. The previous review, from 30 September, is kept as the
baseline in the "Was" column.

Legend:
- **Met**: the acceptance criterion passes end to end.
- **Partial**: the mechanism exists, but at least one clause of the AC does not hold.
- **Not met**: nothing implements the clause yet.

| # | Story | Importance | Points | Was | Now | Remaining gap |
|---|-------|-----------|--------|-----|-----|---------------|
| 1 | Customer Enquiries | Must | 3 | Met | **Met** | No `ChatService` test; placeholder AI reply is router advice |
| 2 | Technical Support | Must | 2 | Met | **Met** | Hand-off is a queued ticket, not a live agent; client notice still shows `#id` |
| 3 | Service Issues | Must | 3 | Met | **Met** | Confirmation is free text only; the state machine has no server test |
| 4 | Complaints Logging | Must | 1 | Partial | Partial | The session is not ended; no authentication; client not yet updated for the ticket merge |
| 5 | Architecture (IoC) | Should | 5 | Met | **Met** | None |
| 6 | System Concurrency | Could | 5 | Partial | Partial | Still no deliberate concurrency control or load evidence |
| 7 | Security & Quality | Must | 5 | Partial | Partial | No integration tests, no CI, README is empty, DB still tracked, no GDPR note |

Since the last review, three gaps have closed:
- Enquiries now carry the conversation history.
- Complaints ask for details before logging.
- The chat reply and the dashboard now quote the same ticket reference.

Complaints have also been folded into tickets on the server (`SupportTicket` with
`Type = Complaint`). The client has not followed yet, so in live mode the complaints dashboard
calls an endpoint that no longer exists (see story 4). Most of what remains is **evidence**
rather than behaviour. Story 7's tests, CI and documentation carry the largest rubric weight
(testing 20 %, documentation 10 %).

---

## 1. Customer Enquiries: Met

> Given a customer chat session, when the intent is classified as a 'general enquiry', then
> the AI model API generates and returns a contextual response entirely within the GUI.

**What holds**

- Classification is a hybrid. `RuleBasedClassifier` scores weighted phrases and decides when
  its confidence is ≥ 0.6. Otherwise `ClassificationService` asks the AI. It accepts the answer
  only if it names exactly one known category, and falls back to the rules if the AI fails
  ([ClassificationService.cs](AP-Master.Server/Services/ClassificationService.cs)).
  Follow-up messages are classified against the current topic (`ClassifyFollowUpAsync`), so
  "how much is that?" stays an enquiry.
- **Contextual, now closed.** Every AI call sends the stored conversation, not just the latest
  message: up to 20 messages or 12,000 characters, set by `AI:MaxHistoryMessages` and
  `AI:MaxHistoryCharacters`
  ([ChatService.cs:460](AP-Master.Server/Services/ChatService.cs:460),
  [AIChatHistory.cs](AP-Master.Server/Services/AIChatHistory.cs)). The enquiry prompt tells the
  model to use it for follow-ups and not to repeat itself.
- `AIService` calls a real OpenAI-compatible endpoint (OpenRouter). Timeouts, HTTP errors, bad
  JSON and empty responses all map to `AIServiceException`
  ([AIService.cs](AP-Master.Server/Services/AIService.cs)).
- Graceful degradation. `TryGenerateChatReplyAsync` turns any failure into `null`, and the
  enquiry path then replies with a fixed apology instead of a 500. A client cancellation is
  rethrown rather than mistaken for an AI failure.
- Scope. A shared company context limits the assistant to Telegroup's services. The ticket and
  complaint paths can answer with an `[OUT_OF_SCOPE]` marker, so an unrelated request ("my
  toilet is broken") gets a polite refusal and never becomes a ticket
  ([ChatService.cs:437](AP-Master.Server/Services/ChatService.cs:437)).
- Prompt-injection guards:
  - Every system prompt states that customer messages are never instructions.
  - The classifier prompt also wraps the text in `<customer_message>` tags.
- The reply is persisted and shown in the chat view with a "Customer enquiry" triage label.

**Loose ends**

- With no API key, `DummyAIService` answers every request with router-restart advice. It now
  reports how much history it received, which is useful for checking the plumbing, but the
  reply is still odd for "What are your opening hours?". A neutral placeholder is worth adding
  before the demo, in case the key or network fails on the day.
- No `ChatService` test pins the enquiry path or its fallback.

## 2. Technical Support: Met

> Given a live chat, when the intent is a 'technical support request', then the system
> immediately connects to a human.

**What holds**

- A technical-support message raises a `SupportTicket` (`Type = TechnicalSupport`) in the
  same request, sets the conversation to `Escalated`, and persists the hand-off reply. The AI
  writes a short acknowledgement first. If the request is out of scope, no ticket is raised.
- Duplicates are prevented. A further technical-support message in a conversation that
  already has an open ticket gets an AI answer about that ticket instead of a second one.
- **References now match.** The chat reply quotes the stored reference (`TKT-` plus eight hex
  characters; older tickets keep `TKT-000042`), and the dashboard shows the same string.
- The human side exists:
  - `GET /api/tickets`, which filters by status, type, severity, escalation and customer.
  - `GET /api/tickets/{id}`, `PUT /api/tickets/{id}/status`, `POST /api/tickets/{id}/close`
    and `POST /api/tickets/{id}/escalate`.
  - Conversation and message reads.

  The agent dashboard shows the ticket in the queue, opens it with its conversation
  transcript, and moves it through `AwaitingTechnician → InProgress → Resolved → Closed`. It
  returns a 409 if a closed ticket is reopened.

**Loose ends**

- "Immediately connects" is met only in the queued-hand-off sense, and the report should say
  so. Nothing is pushed to the agent: the dashboard shows the ticket on its next load. SSE or
  SignalR would make it literal, and would also serve the networking criterion.
- The client notice still reads "Support ticket #42" (built from `ticketId`), while the
  message above it quotes the reference. Adding the reference to `ChatResponse`, or dropping
  the number from the notice, would remove the mismatch.

## 3. Service Issues: Met

> Given a reported service issue, when the AI provides troubleshooting steps, then it must
> prompt the user to confirm resolution, transferring to a human technician if answered "No".

**What holds**

- The AI generates numbered troubleshooting steps. The reply ends with "Did that fix the
  problem? …", and the conversation moves to `Troubleshooting`. Because the AI sees the
  history, it builds on steps already tried instead of repeating them.
- If the customer has not said what is wrong ("I have an issue"), the AI asks one question
  instead, using the `[NEED_DETAILS]` marker. Troubleshooting does not start until it has
  something to work with.
- The next message in a troubleshooting conversation is **not re-classified**.
  `TroubleshootingOutcomeDetector` reads it as Resolved, NotResolved or Unclear. It checks
  negatives first, so "thanks, but it's still not working" is not taken as a yes
  ([TroubleshootingOutcomeDetector.cs](AP-Master.Server/Services/TroubleshootingOutcomeDetector.cs)).
- Resolved sets the status to `Resolved` and sends a closing reply.
- Not resolved does four things:
  - Raises a ticket with `Type = ServiceIssue`, described by the customer's whole side of the
    conversation.
  - Sets the status to `Escalated`.
  - Returns the `ticketId`.
  - Makes the client show its ticket notice.

  If an open ticket already exists, it is reused.
- If the AI cannot produce steps at all, the customer goes straight to a ticket instead of
  being left without help.
- The mock client mirrors the loop, and `mock.test.ts` covers both the resolved and
  not-resolved branches.

**Loose ends**

- The customer must type the answer. Quick-reply "Yes, it's fixed" / "No, still broken"
  buttons after a service-issue reply would make the prompt obvious in the demo and remove the
  chance of an `Unclear` answer. This is a client-only change: the buttons would just send
  those phrases.
- An `Unclear` reply falls through to normal classification. That is sensible but
  undocumented.
- No server test covers the state machine or the detector.

## 4. Complaints Logging: Partial

> Given a complaint request, when details are collected, then the system securely writes
> data to the database, assigns an official ticket number, displays it, and ends the session.

**What holds**

- **Details are collected, now closed.** `ComplaintDetails.HasDetails` recognises a message
  that only expresses the wish to complain ("I want to make a complaint"). The assistant then
  asks what happened, when, and what the customer wants done. The next message stays on the
  complaint topic and becomes the complaint
  ([ChatService.cs:294](AP-Master.Server/Services/ChatService.cs:294)). `ComplaintDetailsTests`
  covers this.
- Writes to the database. Complaints are now tickets: a `SupportTicket` row with
  `Type = Complaint`, status `Open`, and a category and severity set by rules, never by the
  AI. `Escalated` is set for High severity. Complaints about something unrelated to Telegroup
  are refused, not logged.
- Official number. The reference is `CMP-` plus eight hex characters, stored with a unique
  index. Complaints that existed before the merge kept their references.
- Displays it:
  - The reply ("Your reference is CMP-…") is persisted and shown in the chat, and the response
    now carries the `ticketId`.
  - A follow-up in the same conversation gets an answer about the existing complaint, not a
    second one.
  - Staff can list complaints with `GET /api/tickets?type=3`, filter by status, severity and
    escalation, and escalate manually.
- Partly secure. `GetOwnedAsync` refuses to post into another customer's conversation. It
  reports the attempt as a 404, so conversation ids cannot be probed.

**What does not**

- "Ends the session": the conversation is left `Active` (or `Escalated`), and the client keeps
  the composer open on the same `conversationId`. The next message simply continues.
- "Securely": there is no authentication, so the `customerId` in the request body is trusted.
  CORS is `AllowAnyOrigin`. HTTPS is the only transport protection.
- **The client has not followed the ticket merge** (see `FRONTEND-TICKET-MERGE.md`). The server
  side of this story is done and works, but the client needs updating before the demo:
  - In live mode the complaints dashboard still calls `/api/complaints`, which now returns 404.
  - Because complaints now return a `ticketId`, the chat shows "Support ticket #… raised" for
    a complaint.
  - Mock mode is unaffected.

**To close**

1. Client: apply `FRONTEND-TICKET-MERGE.md`.
2. Server: set the conversation to `Resolved` after a complaint is logged, and return the
   conversation status (or an `ended` flag) in `ChatResponse`.
3. Client: when a response says the conversation has ended, disable the composer and offer
   "Start a new conversation".
4. Report: state the trust boundary plainly (no authentication by design for the prototype,
   with an ownership check in place) rather than leaving "securely" unqualified.

## 5. Architecture (IoC): Met

> Given the system's reliance on external AI model, when the application instantiates, then
> the AI API is injected via an interface.

**What holds**

- `ChatService` and `ClassificationService` depend only on `IAIService`. `Program.cs` chooses
  the implementation at start-up: `DummyAIService` when no key is configured, otherwise a
  typed `HttpClient` for `AIService`. That is IoC doing visible work: swapping the provider is
  configuration, not code.
- **Demonstrated by a test.** `ClassificationServiceTests` substitutes a `FakeAIService` to
  prove three things:
  - The AI is not called when the rules are confident.
  - Its answer is used when the rules are not.
  - A failed or unparseable answer falls back to the rules.
- Every service is registered behind an interface in `DependencyInjection.cs`.
  `ITroubleshootingOutcomeDetector` follows the same pattern, so it could later be backed by
  the AI without touching `ChatService`. The complaints merge removed a service without
  touching any consumer other than `ChatService`.
- On the client, components depend on the `ApiClient` interface via `useApi()`.
  `MockApiClient` and `HttpApiClient` swap on `VITE_API_MODE`, and tests inject their own.

## 6. System Concurrency: Partial

> Given massive spikes in concurrent users, when processing messages, then threads are
> handled asynchronously.

**What holds**

- Async all the way down. Cancellation is passed from each controller through every service
  and EF call, with one `DbContext` per request.
- The AI call has a configured timeout (30 s) and distinguishes a timeout from a client
  cancellation. `ExceptionHandlingMiddleware` logs a client disconnect instead of writing a
  response nobody will read.
- Client: every request takes an `AbortSignal`, and stale results are ignored.

**What does not**

- Nothing is deliberate yet: no rate limiting, no limit on concurrent calls to the AI
  provider, and no load evidence. The rubric's wording is "deliberate concurrency control, not
  incidental `async`".
- One turn can make several sequential AI calls, each allowed 30 s:
  - An ambiguous first message is classified, then answered.
  - A complaint or technical-support message gets an acknowledgement before the ticket is
    written.

  Now that up to 20 history messages are sent on every call, each request is also larger.

**To close**

1. A `SemaphoreSlim` around the provider call in `AIService`, with a short wait that degrades
   to the existing fallback when saturated.
2. `AddRateLimiter` on `api/chat`.
3. A recorded load run against `POST /api/chat` with the dummy provider, showing that
   requests overlap rather than run one after another.

## 7. Security & Quality: Partial

> Given a new feature push, when submitted for review, then inputs must be sanitised, code
> fully documented, and passing automated unit and integration tests must be evidenced.

**Inputs: holds**

- DataAnnotations on the request DTOs, plus `MessageService.ValidateCustomerContent`, which
  trims and length-checks (2,000 characters). Assistant replies over 4,000 characters are
  truncated rather than rejected.
- Errors are consistent. `ExceptionHandlingMiddleware` maps:
  - `NotFoundException` → 404
  - `ConflictException` → 409
  - `BadRequestException` → 400
  - anything else → a generic 500 with no internal detail

  All of them are ProblemDetails with a `traceId`, and the client shows that trace reference
  in its error banner.
- EF Core parameterises queries, React escapes rendered text, and prompts tell the model that
  customer text is not instructions.

**Documentation: partly holds**

- XML doc comments cover the services and controllers, and the client is commented at the
  seam.
- Design documents now exist: a class diagram (`class-diagram.drawio` / `.png`) and a database
  schema (`schema.dbml`).
- `README.md` is a single heading. There is no run/test guide and no architecture overview. It
  also lacks the APA 7 acknowledgement of external resources and AI-assisted development that
  the academic-integrity criterion requires.

**Automated tests: half holds**

- Server: **41 passing**:
  - `CustomerServiceTests` against in-memory SQLite.
  - Table-driven `RuleBasedClassifierTests`.
  - `ClassificationServiceTests` with a fake AI.
  - `ComplaintDetailsTests`.
- Client: **124 passing** across 12 files. They include a TypeScript port of the server's
  classifier tests, so the mock cannot drift from the C# rules.
- Missing:
  - `ChatService` tests for the four workflows and the troubleshooting loop.
  - `TicketService` and `ConversationService` tests.
  - Any `WebApplicationFactory` integration test over HTTP.
  - CI to run the suites on push.
  - A recorded user-acceptance test.

**GDPR: does not hold**

- The seeded SQLite database (`Development/Data/telegroup.db` and its `-shm`/`-wal` files) is
  still tracked in git. A local, uncommitted `.gitignore` change adds `*.db`, but ignoring a
  tracked file does not untrack it: it also needs `git rm --cached`.
- Customer messages go to an external provider (OpenRouter free models), now with up to 20
  messages of history per call. This needs a data-handling note covering what is sent, that
  the data is fictional, and that production use would need a data-processing agreement or a
  local model.
- There is no retention policy, deletion path or consent step.

**To close**

1. `ChatService` unit tests with fakes, which also serve as evidence for stories 1–4, plus a
   handful of `WebApplicationFactory` tests for 200, 400, 404 and 409.
2. A GitHub Actions workflow running `dotnet test`, `npm ci`, `npm run lint` and `npm test`.
3. A README (run, test, architecture) and an APA 7 acknowledgements section.
4. Untrack the database and add the data-handling note.

---

## Cross-cutting issues

Progress on the issues found in earlier reviews, plus new ones.

| Issue | Stories | State |
|-------|---------|-------|
| No ownership check on `conversationId` | 4, 7 | **Fixed**: `GetOwnedAsync`, reported as 404 |
| Not-found surfaced as 500 | 7 | **Fixed**: middleware maps `ApiException`s |
| `traceId` missing from error responses | 7 | **Fixed** |
| `requestType` inconsistent between paths | 1–4 | **Fixed** |
| Technical-support reply not persisted | 2 | **Fixed** |
| Complaint reference could collide | 4 | **Fixed**: GUID-based, unique index |
| `IAIService` registered twice | 5 | **Fixed** |
| `AIService` stub | 1, 3 | **Fixed**: OpenRouter with fallback |
| Enquiry prompt carries only the latest message | 1 | **Fixed**: stored history sent on every call |
| Complaint logged without details | 4 | **Fixed**: `ComplaintDetails` asks first |
| Unrelated requests became tickets or complaints | 2–4 | **Fixed**: `[OUT_OF_SCOPE]` handling |
| Duplicate complaint or ticket in one conversation | 2–4 | **Fixed**: open case reused |
| Ticket reference differs between chat reply and dashboard | 2 | **Fixed**: both use the stored reference |
| Complaints and tickets modelled separately | 2, 4 | **Fixed** on the server: one `SupportTicket` with a `Type` |
| Client not updated for the ticket merge (complaints panel 404s in live mode) | 2, 4 | New: see `FRONTEND-TICKET-MERGE.md` |
| Chat notice shows `#id` rather than the reference | 2 | Open |
| SQLite database tracked in git | 7 | Open |
| Placeholder AI reply is router advice for every request type | 1 | Open |
| Customer text sent to an external AI provider with no data note | 7 | Open |
| CORS allows any origin | 4, 7 | Open (low risk: the SPA is same-origin) |

## Suggested order

By rubric weight against effort, with owner:

1. **Client ticket merge** (Oliver): apply `FRONTEND-TICKET-MERGE.md`. It is small, and until
   it lands the live dashboard is broken for complaints.
2. **Story 7 tests and CI** (irris for the server tests; either of us for CI). These carry the
   most remaining marks, and the `ChatService` tests also serve as evidence for stories 1–4.
3. **Story 4 end of session** (irris: status in `ChatResponse`; Oliver: disable the composer
   and add "Start a new conversation"). This is the only Must story still Partial.
4. **Story 7 docs** (both): README, APA acknowledgements, data-handling note, untrack the DB.
5. **Story 6** (irris): semaphore on the AI call, rate limiter, one load run.
6. **Polish before the demo**:
   - Reference in the chat notice (Oliver).
   - Yes/No quick replies after troubleshooting (Oliver).
   - A neutral placeholder AI reply (irris).
