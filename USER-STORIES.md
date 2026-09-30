# User story alignment

How the artefact stands against the seven user stories, as of 30 September 2026 (master at
`4de56bd`). Each verdict comes from reading the code and running it: the server and client
were run together against the live AI provider, both test suites were run
(server **30/30**, client **81/81**), and the previous review of 16 September is kept as the
baseline in the "Was" column.

Legend: **Met** — the acceptance criterion passes end to end. **Partial** — the mechanism
exists but at least one clause of the AC does not hold. **Not met** — nothing implements the
clause yet.

| # | Story | Importance | Points | Was | Now | Remaining gap |
|---|-------|-----------|--------|-----|-----|---------------|
| 1 | Customer Enquiries | Must | 3 | Partial | **Met** | Prompt carries only the latest message, so follow-ups lose context |
| 2 | Technical Support | Must | 2 | Partial | **Met** | Hand-off is a queued ticket, not a live agent; chat shows `#42`, dashboard `TKT-000042` |
| 3 | Service Issues | Must | 3 | Not met | **Met** | Confirmation is free text only; the state machine has no server test |
| 4 | Complaints Logging | Must | 1 | Partial | Partial | The session is not ended; no details-collection step; no authentication |
| 5 | Architecture (IoC) | Should | 5 | Met | **Met** | None — now demonstrated by a test with a fake `IAIService` |
| 6 | System Concurrency | Could | 5 | Partial | Partial | Still no deliberate concurrency control or load evidence |
| 7 | Security & Quality | Must | 5 | Partial | Partial | No integration tests, no CI, README is empty, DB still tracked, no GDPR note |

Three of the four functional Must stories are now met. What is left is mostly **evidence**
rather than behaviour: story 7's integration tests, CI and documentation carry the largest
rubric weight (testing 20 %, documentation 10 %), and story 4 needs one small cross-stack
change to end the session.

---

## 1. Customer Enquiries — Met

> Given a customer chat session, when the intent is classified as a 'general enquiry', then
> the AI model API generates and returns a contextual response entirely within the GUI.

**What holds**

- Classification is now a hybrid: `RuleBasedClassifier` scores weighted phrases and decides
  when its confidence is ≥ 0.6; otherwise `ClassificationService` asks the AI, accepting its
  answer only if it names exactly one known category, and falls back to the rules if the AI
  fails ([ClassificationService.cs](AP-Master.Server/Services/ClassificationService.cs)).
- `AIService` calls a real OpenAI-compatible endpoint (OpenRouter), with timeout, HTTP-error,
  bad-JSON and empty-response handling all mapped to `AIServiceException`
  ([AIService.cs](AP-Master.Server/Services/AIService.cs)). Confirmed live: the server logged
  a reply from `nvidia/nemotron-3-super-120b-a12b:free` in about 2.5 s.
- Graceful degradation: `ChatService.TryGenerateAIResponseAsync` turns any failure into
  `null`, and the enquiry path replies with a fixed apology instead of a 500. A client
  cancellation is rethrown rather than mistaken for an AI failure
  ([ChatService.cs:234](AP-Master.Server/Services/ChatService.cs:234)).
- The prompt wraps the customer's text in `<customer_message>` tags and tells the model to
  treat it as data — a basic prompt-injection guard.
- The reply is persisted and shown in the chat view with a "Customer enquiry" triage label.

**Loose ends**

- "Contextual": only the current message is sent. A follow-up such as "and how much is
  that?" reaches the model with no history. Feeding the last few `Message` rows into the
  prompt would close this.
- With no API key, `DummyAIService` answers every enquiry with router-restart advice. Fine for
  service issues, odd for "What are your opening hours?" — worth a neutral placeholder before
  the demo in case the key or network fails on the day.
- No `ChatService` test pins the enquiry path or its fallback.

## 2. Technical Support — Met

> Given a live chat, when the intent is a 'technical support request', then the system
> immediately connects to a human.

**What holds**

- Technical-support messages raise a `SupportTicket` in the same request, set the
  conversation to `Escalated`, and the hand-off reply is now **persisted** (every path goes
  through `ReplyAsync`). The "out technical support team" typo is gone.
- The human side exists: `GET /api/tickets` (filter by status and customer),
  `GET /api/tickets/{id}`, `PUT /api/tickets/{id}/status`, `POST /api/tickets/{id}/close`,
  and conversation/message reads. The agent dashboard is wired to all of them in live mode:
  the ticket appears in the queue, opens with its conversation transcript, and can be moved
  through `AwaitingTechnician → InProgress → Resolved → Closed`, with 409s when a closed
  ticket is reopened.

**Loose ends**

- "Immediately connects" is met in the queued-hand-off sense, which should be stated in the
  report. There is no push to the agent: the dashboard shows the ticket on its next load.
  SSE or SignalR would make it literal and would also serve the networking criterion.
- The chat reply says "ticket … with ID 42" and the client notice reads "Support ticket #42",
  while the dashboard shows `TKT-000042`. The server already has `TicketReference.For(id)`;
  using it in the reply (and adding the reference to `ChatResponse`) would make the customer
  and agent quote the same number.

## 3. Service Issues — Met

> Given a reported service issue, when the AI provides troubleshooting steps, then it must
> prompt the user to confirm resolution, transferring to a human technician if answered "No".

**What holds**

- The AI generates numbered troubleshooting steps, and the reply ends with "Did that fix the
  problem? …". The conversation moves to `Troubleshooting`.
- The next message in that conversation is **not re-classified**: `TroubleshootingOutcomeDetector`
  reads it as Resolved, NotResolved or Unclear, checking negatives first so "thanks, but it's
  still not working" is not taken as a yes
  ([TroubleshootingOutcomeDetector.cs](AP-Master.Server/Services/TroubleshootingOutcomeDetector.cs)).
- Resolved → status `Resolved` and a closing reply. Not resolved → a ticket whose description
  is the customer's whole side of the conversation, status `Escalated`, `ticketId` returned,
  and the client shows its ticket notice.
- If the AI cannot produce steps at all, the customer goes straight to a ticket instead of
  being left without help.
- The mock client mirrors the loop, and `mock.test.ts` covers both the resolved and
  not-resolved branches; verified live through the browser.

**Loose ends**

- The customer must type the answer. Quick-reply "Yes, it's fixed" / "No, still broken"
  buttons after a service-issue reply would make the prompt obvious in the demo and remove
  the chance of an `Unclear` answer. Client-only change; the buttons would just send those
  phrases.
- An `Unclear` reply falls through to normal classification, which is sensible but
  undocumented.
- No server test covers the state machine or the detector.

## 4. Complaints Logging — Partial

> Given a complaint request, when details are collected, then the system securely writes
> data to the database, assigns an official ticket number, displays it, and ends the session.

**What holds**

- Writes to the database: a `Complaint` row with category, severity (rule-based, never the
  AI) and `Escalated` set for High severity.
- Official number: the reference is now `CMP-` plus eight hex characters from a GUID, so the
  earlier five-digit collision risk against the unique index is gone.
- Displays it: the reply ("Your complaint reference is CMP-…") is persisted and shown in the
  chat, and the complaints dashboard lists it with status, severity and escalation filters and
  a manual Escalate action.
- More secure than before: `GetOwnedAsync` refuses to post into another customer's
  conversation, reporting it as 404 so conversation ids cannot be probed.

**What does not**

- "Ends the session": the conversation is left `Active` (or `Escalated`), and the client keeps
  the composer open on the same `conversationId`. The next message simply continues.
- "When details are collected": one message is the whole complaint; nothing asks for missing
  detail or confirms what was recorded.
- "Securely": there is no authentication, so `customerId` in the request body is trusted.
  CORS is `AllowAnyOrigin`. HTTPS is the only transport protection.

**To close**

1. Server: set the conversation to `Resolved` after a complaint is logged, and return the
   conversation status (or an `ended` flag) in `ChatResponse`.
2. Client: when a response says the conversation ended, disable the composer and offer
   "Start a new conversation".
3. Report: state the trust boundary plainly (no authentication by design for the prototype,
   ownership check in place) rather than leaving "securely" unqualified.

## 5. Architecture (IoC) — Met

> Given the system's reliance on external AI model, when the application instantiates, then
> the AI API is injected via an interface.

**What holds**

- `ChatService` and `ClassificationService` depend on `IAIService` only. `Program.cs`
  chooses the implementation at start-up: `DummyAIService` when no key is configured,
  otherwise a typed `HttpClient` for `AIService`. That is IoC doing visible work — swapping
  the provider is configuration, not code.
- The earlier double registration is gone.
- **Demonstrated by a test**: `ClassificationServiceTests` substitutes a `FakeAIService` to
  prove the AI is not called when the rules are confident, that its answer is used when they
  are not, and that a failed or unparseable answer falls back to the rules.
- `ITroubleshootingOutcomeDetector` follows the same pattern, so it could later be backed by
  the AI without touching `ChatService`.
- On the client, components depend on the `ApiClient` interface via `useApi()`;
  `MockApiClient` and `HttpApiClient` swap on `VITE_API_MODE`, and tests inject their own.

## 6. System Concurrency — Partial

> Given massive spikes in concurrent users, when processing messages, then threads are
> handled asynchronously.

**What holds**

- Async all the way down, cancellation threaded from each controller through every service
  and EF call, one `DbContext` per request.
- New since last time: the AI call has a configured timeout (30 s) and distinguishes a timeout
  from a client cancellation; `ExceptionHandlingMiddleware` logs a client disconnect instead of
  writing a response nobody will read.
- Client: every request takes an `AbortSignal`, and stale results are ignored.

**What does not**

- Nothing is deliberate yet: no rate limiting, no bound on concurrent calls to the AI
  provider, no load evidence. The rubric's wording is "deliberate concurrency control, not
  incidental `async`".
- An ambiguous service-issue message can make two sequential AI calls (classify, then
  troubleshoot), each allowed 30 s, so a worst-case turn is about a minute.

**To close**

1. A `SemaphoreSlim` around the provider call in `AIService`, with a short wait that degrades
   to the existing fallback when saturated.
2. `AddRateLimiter` on `api/chat`.
3. A recorded load run against `POST /api/chat` with the dummy provider, showing requests
   overlap rather than serialise.

## 7. Security & Quality — Partial

> Given a new feature push, when submitted for review, then inputs must be sanitised, code
> fully documented, and passing automated unit and integration tests must be evidenced.

**Inputs — holds**

- DataAnnotations on the request DTOs, plus `MessageService.ValidateCustomerContent`, which
  trims and length-checks. Assistant replies over the limit are truncated rather than
  rejected.
- Errors are consistent: `ExceptionHandlingMiddleware` maps `NotFoundException` → 404,
  `ConflictException` → 409, `BadRequestException` → 400, anything else → a generic 500 with no
  internal detail, all as ProblemDetails with a `traceId`. The client shows the trace
  reference in its error banner.
- EF Core parameterises queries; React escapes rendered text; prompts delimit customer text.

**Documentation — partly holds**

- XML doc comments now cover the services and controllers (about 110 `///` lines). The
  client is commented at the seam.
- `README.md` is a single heading. There is no run/test guide, no architecture overview, and
  no APA 7 acknowledgement of external resources or AI-assisted development, which the
  academic-integrity criterion requires.

**Automated tests — half holds**

- Server: **30 passing** — `CustomerServiceTests` against in-memory SQLite, table-driven
  `RuleBasedClassifierTests`, and `ClassificationServiceTests` with a fake AI.
- Client: **81 passing** across nine files, including a TypeScript port of the server's
  classifier tests so the mock cannot drift from the C# rules. Lint and type-check clean.
- Missing: `ChatService` tests for the four workflows and the troubleshooting loop;
  `TicketService`/`ComplaintService`/`ConversationService` tests; any `WebApplicationFactory`
  integration test over HTTP; CI to run the suites on push; a recorded user-acceptance test.

**GDPR — does not hold**

- The seeded SQLite database with customer names and emails is still tracked in git.
- **New concern**: customer messages now go to an external provider (OpenRouter free models)
  rather than a local model. This needs a data-handling note — what is sent, that the data is
  fictional, and that production use would need a data-processing agreement or a local model.
- No retention policy, deletion path or consent step.

**To close**

1. `ChatService` unit tests with fakes (covers stories 1–4 as evidence) and a handful of
   `WebApplicationFactory` tests for 200, 400, 404 and 409.
2. A GitHub Actions workflow: `dotnet test`, `npm ci`, `npm run lint`, `npm test`.
3. README (run, test, architecture) and an APA 7 acknowledgements section.
4. Untrack the database; add the data-handling note.

---

## Cross-cutting issues

Progress on the issues found by running the server on 16 September, plus new ones.

| Issue | Stories | State |
|-------|---------|-------|
| No ownership check on `conversationId` | 4, 7 | **Fixed** — `GetOwnedAsync`, reported as 404 |
| Not-found surfaced as 500 | 7 | **Fixed** — middleware maps `ApiException`s; old handler removed |
| `traceId` missing from error responses | 7 | **Fixed** |
| `requestType` inconsistent between paths | 1–4 | **Fixed** — each handler passes its own type to `ReplyAsync` |
| Technical-support reply not persisted | 2 | **Fixed** |
| Complaint reference could collide | 4 | **Fixed** — GUID-based |
| `IAIService` registered twice | 5 | **Fixed** |
| `AIService` stub | 1, 3 | **Fixed** — OpenRouter with fallback |
| SQLite database tracked in git | 7 | Open |
| Ticket shown as `#42` in chat, `TKT-000042` on the dashboard | 2 | New |
| Placeholder AI reply is router advice for every request type | 1 | New |
| Customer text sent to an external AI provider with no data note | 7 | New |
| CORS allows any origin | 4, 7 | Open (low risk: the SPA is same-origin) |

## Suggested order

By rubric weight against effort, with owner:

1. **Story 7 tests + CI** (irris, server tests; either of us, CI) — the largest remaining
   marks, and `ChatService` tests are also the evidence for stories 1–4.
2. **Story 4 end of session** (irris: status in `ChatResponse`; Oliver: disable composer,
   "Start a new conversation") — the only Must story still Partial.
3. **Story 7 docs** (both) — README, APA acknowledgements, data-handling note, untrack the DB.
4. **Story 6** (irris) — semaphore on the AI call, rate limiter, one load run.
5. **Polish before the demo** — ticket reference in the chat reply (irris) and the client
   notice (Oliver); Yes/No quick replies after troubleshooting (Oliver); conversation history
   in the enquiry prompt and a neutral placeholder reply (irris).
