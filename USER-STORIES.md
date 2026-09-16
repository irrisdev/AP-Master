# User story alignment

How the artefact stands against the seven user stories, as of 16 September 2026. Each
verdict is taken from reading the code and from running the server and client together
(`POST /api/chat` was exercised with curl and through the React client), not from the plan.

Legend: **Met** — the acceptance criterion passes end to end. **Partial** — the mechanism
exists but at least one clause of the AC does not hold. **Not met** — nothing implements the
clause yet.

| # | Story | Importance | Points | Status | Blocking gap |
|---|-------|-----------|--------|--------|--------------|
| 1 | Customer Enquiries | Must | 3 | Partial | `AIService` returns the literal `"not implemented"`; Ollama is configured but never called |
| 2 | Technical Support | Must | 2 | Partial | A ticket is raised, but nothing "connects to a human" — no agent-facing read endpoints |
| 3 | Service Issues | Must | 3 | Not met | No "did this resolve it?" prompt and no transfer on "No", on either side |
| 4 | Complaints Logging | Must | 1 | Partial | Written and displayed, but not "securely" and the session is not ended |
| 5 | Architecture (IoC) | Should | 5 | Met | Minor: `IAIService` is registered twice |
| 6 | System Concurrency | Could | 5 | Partial | Async and cancellation throughout, but no deliberate concurrency control or load evidence |
| 7 | Security & Quality | Must | 5 | Partial | Inputs validated; 48 client tests; **zero server tests**; no GDPR measures |

Four Must stories are open. Stories 3 and 1 are the largest functional gaps; story 7's
server-test gap is the largest assessment risk because the rubric marks testing at 20 %.

---

## 1. Customer Enquiries — Partial

> Given a customer chat session, when the intent is classified as a 'general enquiry', then
> the AI model API generates and returns a contextual response entirely within the GUI.

**What holds**

- Classification: `ClassificationService.Classify` falls through to
  `RequestType.CustomerEnquiry` when no complaint, technical or service keyword matches
  ([ClassificationService.cs](AP-Master.Server/Services/ClassificationService.cs)).
- Dispatch: `ChatService.HandleCustomerEnquiryAsync` builds a system prompt (assistant
  persona, "do not invent account information", "suggest a human if uncertain") and calls
  `IAIService.GenerateResponseAsync` ([ChatService.cs:106](AP-Master.Server/Services/ChatService.cs:106)).
- Persistence: both the customer message and the AI reply are saved as `Message` rows with
  senders `"Customer"` and `"AI"`.
- GUI: the React chat view sends the message, shows the reply as an assistant bubble, and
  labels the triage outcome ("Customer enquiry") — `ChatView.tsx`, verified live against the
  server and pinned by `ChatView.test.tsx`.

**What does not**

- `AIService.GenerateResponseAsync` is `Task.FromResult("not implemented")`
  ([AIService.cs:18](AP-Master.Server/Services/AIService.cs:18)). In live mode every enquiry
  is answered with the words "not implemented". The response is therefore neither
  "generated" nor "contextual". The `Ollama` section in `appsettings.json` (`llama3.2`) is
  read by nobody.
- Only the latest message is sent to the model — the prompt does not include prior turns, so
  a follow-up question loses context even once the provider is wired in.

**To close**

1. Implement the Ollama call in `AIService` (`POST /api/generate` or `/api/chat` on the
   configured base URL), honour the `CancellationToken`, and map provider failure to a
   graceful fallback message rather than a 500 — the rubric explicitly rewards degradation
   when the AI provider is unavailable.
2. Feed the conversation's recent `Message` rows into the prompt so the answer is contextual
   across turns.
3. A unit test with a faked `IAIService` proving the enquiry path returns what the service
   produced and saves it.

## 2. Technical Support — Partial

> Given a live chat, when the intent is a 'technical support request', then the system
> immediately connects to a human.

**What holds**

- Classification on "router", "technical", "cannot connect", "can't connect".
- `HandleTechnicalSupportAsync` creates a `SupportTicket` via `ITicketService`, sets the
  conversation to `Escalated`, and replies with the ticket id in the same request — so the
  hand-off is "immediate" in the sense of the AC
  ([ChatService.cs:163](AP-Master.Server/Services/ChatService.cs:163)).
- GUI shows a "Support ticket #n raised" notice and a "Technical support" triage label.

**What does not**

- Nothing connects anyone to a human. There is no agent side: `TicketsController`,
  `ConversationsController` and `ComplaintsController` are routed shells with **no GET
  endpoints**, so an agent has no way to see the queue. The client's agent dashboard is
  built and tested but runs on mock data because there is nothing to read from.
- The reply text is returned but **not saved** as a `Message` — the technical-support path
  is the only one that skips `SaveAIMessageAsync`, so the transcript an agent would later
  read is missing the hand-off line.
- Typo in the customer-facing text: "passed to out technical support team".

**To close**

1. Define what "connects to a human" means for the demo. The realistic reading is: the
   ticket appears in the agent dashboard's queue with the conversation transcript attached,
   and the customer is told an agent will pick it up. That needs `GET /api/tickets`,
   `GET /api/tickets/{id}`, `GET /api/conversations/{id}` and `PATCH /api/tickets/{id}/status`
   — the shapes are already proposed in `ap-master.client/src/api/types.ts`.
2. Persist the hand-off reply with `SaveAIMessageAsync`.
3. Stretch: a live agent view of the conversation (SSE or SignalR) would make "connects"
   literal and would also serve the networking criterion in the rubric.

## 3. Service Issues — Not met

> Given a reported service issue, when the AI provides troubleshooting steps, then it must
> prompt the user to confirm resolution, transferring to a human technician if answered "No".

**What holds**

- Classification on "slow", "outage", "not working", "disconnect".
- `HandleServiceIssueAsync` sets the conversation to `Troubleshooting` and asks the AI for
  "simple, safe troubleshooting instructions"
  ([ChatService.cs:134](AP-Master.Server/Services/ChatService.cs:134)). The `Troubleshooting`
  status is the right hook for the rest of the story.

**What does not**

- No prompt to confirm resolution. The AI reply is returned and the turn ends.
- No Yes/No handling. A follow-up of "no, still broken" is re-classified from scratch by
  keyword; "no" alone classifies as `CustomerEnquiry` and gets a generic reply.
- No transfer. Nothing moves a `Troubleshooting` conversation to a ticket.
- The client has no affordance for this either — no Yes/No controls after a service-issue
  reply.

**To close** (the biggest functional gap; server and client both need work)

1. Server: when a message arrives for a conversation already in `Troubleshooting`, do not
   re-classify. Interpret the reply as confirmation: resolved → status `Resolved`, closing
   message; not resolved → create a ticket via `ITicketService`, status `Escalated`, return
   `ticketId`. A small explicit field on `ChatRequest` (for example `resolved: bool?`)
   is more robust than parsing "yes"/"no" free text, and keeps the client's buttons honest.
2. Server: append "Did this resolve your issue?" to the troubleshooting reply, or return a
   flag the client can render as a prompt.
3. Client: after a `ServiceIssue` reply, render "Yes, resolved" / "No, still broken"
   buttons that send the confirmation on the same `conversationId`; show the existing
   ticket notice on "No".
4. Tests on both sides: state machine in `ChatService`; button flow in `ChatView.test.tsx`.

## 4. Complaints Logging — Partial

> Given a complaint request, when details are collected, then the system securely writes
> data to the database, assigns an official ticket number, displays it, and ends the session.

**What holds**

- Classification on "complaint", "complain", "unhappy", "disappointed".
- `ComplaintService.CreateComplaintAsync` derives severity (legal/court/data breach/danger →
  High; refund/billing/charged → Medium), a category, a reference `C-nnnnn`, and writes a
  `Complaint` row with a unique index on the reference
  ([ComplaintService.cs](AP-Master.Server/Services/ComplaintService.cs)).
- The reply "Your complaint has been recorded. Your complaint reference is C-nnnnn" is saved
  and returned; the client shows it in the transcript and adds a "Complaint logged and
  escalated" notice when severity is High.

**What does not**

- "Securely": there is no authentication. `customerId` is a plain integer in the request
  body and is trusted; any caller can post as any customer, and any caller can post into any
  existing conversation because `ProcessMessageAsync` never checks the conversation's
  `CustomerId` against the request. HTTPS is on in development, which is the only
  transport-level protection.
- "When details are collected": there is no collection step. One message is the whole
  complaint. No confirmation of what was recorded, no prompt for missing detail.
- "Official ticket number": the reference is `Random.Shared.Next(10000, 99999)`. Two
  complaints can collide; the unique index then throws and the customer sees a 500. A
  sequence or the row id would be official and collision-free.
- "Ends the session": neither side ends anything. The conversation stays `Active` (or
  `Escalated` if High) and the client keeps the composer open on the same `conversationId`.

**To close**

1. Reference from a sequence or from the inserted id (`C-{Id:D5}`).
2. Set the conversation status to `Resolved` (or a new `Closed`) after logging; have the
   client disable the composer and offer "Start a new conversation" when a response carries
   that status — this needs the status in `ChatResponse`, which it currently lacks.
3. Verify `conversation.CustomerId == request.CustomerId`, return 403 otherwise.
4. Authentication is out of scope for the deadline, but say so in the report and explain the
   trust boundary honestly rather than leaving "securely" unqualified.

## 5. Architecture (IoC) — Met

> Given the system's reliance on external AI model, when the application instantiates, then
> the AI API is injected via an interface.

**What holds**

- `IAIService` is an interface with one method; `AIService` implements it; `ChatService`
  takes `IAIService` by constructor and never names the concrete class
  ([AIService.cs](AP-Master.Server/Services/AIService.cs),
  [ChatService.cs:25](AP-Master.Server/Services/ChatService.cs:25)).
- Registration lives in `DependencyInjection.AddApplicationServices`, called from
  `Program.cs`; every service is registered against its interface, so each can be faked.
- The same principle is applied on the client: components depend on the `ApiClient`
  interface via `useApi()` and React context; `MockApiClient` and `HttpApiClient` are swapped
  by configuration (`VITE_API_MODE`) and injected in tests via `renderWithApi`.

**Loose ends**

- `IAIService` is registered twice — `AddScoped<IAIService, AIService>()` and
  `AddHttpClient<IAIService, AIService>()` ([DependencyInjection.cs:14](AP-Master.Server/Properties/DependencyInjection.cs:14)).
  The typed-client registration wins (it is transient), so the scoped line is dead. Remove it
  so the lifetime is what the code says it is.
- The story is only *demonstrably* met once a test substitutes `IAIService`. There is no
  such test yet (see story 7) — the empty `TestFixture` in `AP-Server-Tests/UnitTest1.cs`
  even declares an `IServiceProvider` for exactly that purpose.

## 6. System Concurrency — Partial

> Given massive spikes in concurrent users, when processing messages, then threads are
> handled asynchronously.

**What holds**

- Async all the way down: `ChatController.SendMessage` → `ProcessMessageAsync` → EF Core
  async calls, no `.Result`/`.Wait()`. The request's `CancellationToken` is threaded from the
  controller through every service call and every `SaveChangesAsync`.
- `TelegroupDbContext` is scoped per request, so concurrent requests never share a context.
- Client side: every request takes an `AbortSignal`; `useAbortSignal` cancels in-flight
  writes on unmount and `useAsync` ignores stale results, which is the browser half of the
  same story.

**What does not**

- Nothing is *deliberate*. There is no rate limiting, no bounded concurrency on the AI
  provider (which will be the slow dependency — Ollama on a laptop handles one generation at
  a time), no `SemaphoreSlim`, `Channel`, or background queue, and no evidence under load.
  The rubric's wording is "deliberate concurrency control, not incidental `async`".
- Only Could priority, but it is also a rubric heading in its own right, so cheap wins are
  worth taking.

**To close**

1. Wrap the provider call in a `SemaphoreSlim` sized to what Ollama can serve, with a
   timeout that degrades to a fallback reply — this doubles as the graceful-degradation
   evidence for story 1.
2. Add `AddRateLimiter` on `api/chat`.
3. Record a load run (`bombardier`/`k6` against `POST /api/chat` with a faked provider) in
   the test evidence, showing requests overlap rather than serialise.
4. A cancellation test: abort a request mid-flight and assert no orphan `Message` row.

## 7. Security & Quality — Partial

> Given a new feature push, when submitted for review, then inputs must be sanitised, code
> fully documented, and passing automated unit and integration tests must be evidenced.

**Inputs — largely holds**

- `ChatRequest` carries DataAnnotations: `CustomerId` `[Required, Range(1, …)]`, `Message`
  `[Required, MinLength(1), MaxLength(2000)]`
  ([ChatRequest.cs](AP-Master.Server/DTOs/Chat/ChatRequest.cs)). `[ApiController]` returns
  RFC 7807 `400` with an `errors` map, which the client flattens into the error banner.
- Client mirrors the limit (`limits.chatMessageMax`) and blocks over-long input before it is
  sent; React escapes all rendered text and there is no `dangerouslySetInnerHTML` anywhere.
- EF Core parameterises every query, so there is no injection surface in persistence.
- Gap: `ComplaintRequest` and the (unused) `CustomerRequest` have no annotations yet; nothing
  trims or normalises whitespace; and `customerId`/`conversationId` are validated for shape
  but not ownership (story 4).

**Documentation — does not hold**

- Zero `///` XML doc comments across `Services/` and `Controllers/`. The client is
  commented at the seam (`api/`, hooks) but not "fully".
- Markdown docs exist for the working agreement and task plan; there is no README describing
  how to run, test, or the architecture, and no acknowledgement of external resources or
  AI assistance yet — the rubric's academic-integrity criterion needs this in APA 7.

**Automated tests — half holds**

- Client: **48 passing** Vitest tests across eight files — `HttpApiClient` error mapping,
  `MockApiClient` contract, `useAsync`, validation, `ChatView` (triage, threading, retry,
  accessibility), `TicketsPanel`, `App`. Component tests render the real tree with an
  injected client, which counts as integration at the client level. `npm run lint` is clean.
- Server: **none**. `AP-Server-Tests/UnitTest1.cs` is the template's empty `[Fact]` and an
  empty fixture. No `ClassificationService` tests, no `ChatService` tests with a faked
  `IAIService`, no `WebApplicationFactory` integration test against `POST /api/chat`.
- No CI. "Evidenced on push" has nothing running on push; a GitHub Actions workflow running
  `dotnet test` and `npm test` would satisfy the AC's trigger literally.
- No user-acceptance record yet, which the rubric asks for alongside unit and integration.

**GDPR — does not hold**

- `Customer.Email` and names are stored; the seeded SQLite database containing them is
  committed to the repository (`AP-Master.Server/Development/Data/telegroup.db`). The data is
  fictional, but the practice is what is assessed: untrack the file and keep only the seeder.
- No retention policy, no deletion path, no data-minimisation statement, no consent step in
  the chat. Nothing prevents the AI prompt from echoing customer data to an external
  provider — with local Ollama that is defensible; it should be stated.
- Logging is confined to the global exception handler; there is no request logging to audit,
  and equally no risk yet of logging message bodies. Decide the policy before adding logging.

**To close**

1. Server tests first: `ClassificationService` table-driven unit tests; `ChatService` per
   path with faked `IAIService`/`ITicketService`/`IComplaintService` and SQLite in-memory;
   one `WebApplicationFactory` test per HTTP status the client already handles (200, 400,
   404, 500).
2. GitHub Actions workflow: `dotnet build`, `dotnet test`, `npm ci`, `npm run lint`,
   `npm test`.
3. XML doc comments on every public interface and service; a README; an acknowledgements
   section.
4. Untrack the SQLite file; add a short data-handling note (what is stored, why, for how
   long, fictional-data disclaimer).

---

## Cross-cutting issues that touch several stories

These were confirmed by running the server; each is cheap and each affects an AC above.

| Issue | Where | Stories |
|-------|-------|---------|
| No ownership check on `conversationId` | `ChatService.ProcessMessageAsync` | 4, 7 |
| Not-found surfaces as 500, not 404 | `GlobalExceptionHandler` maps everything to 500 | 7 |
| `traceId` missing from the global handler's ProblemDetails (validation 400s do include it) | `GlobalExceptionHandler` | 7 |
| `escalated: true` on ticket responses as well as complaints; client compensates by also checking `requestType` | `HandleTechnicalSupportAsync` | 2, 4 |
| `requestType` in the response is the stored conversation type on some paths and the freshly classified type on others | all four handlers | 1–4 |
| Technical-support reply not persisted | `HandleTechnicalSupportAsync` | 2 |
| Random complaint reference can collide against a unique index | `ComplaintService` | 4 |
| `IAIService` registered twice | `DependencyInjection` | 5 |
| SQLite database tracked in git | `Development/Data/` | 7 |

## Suggested order

By weight of open Must stories against effort:

1. **Story 3** (service-issue resolution loop) — the only Not met Must; needs both sides.
2. **Story 1** (real Ollama call with fallback) — turns the demo from canned to live and
   yields the degradation evidence for story 6.
3. **Story 7 server tests + CI** — largest rubric exposure, no design decisions needed.
4. **Story 2 GET endpoints** — unblocks the already-built dashboard, makes "connects to a
   human" demonstrable.
5. **Story 4 clean-up** (reference, end-of-session, ownership check) — small, mostly server.
6. Story 5 double registration and story 6 semaphore/rate limiter — an afternoon each.
