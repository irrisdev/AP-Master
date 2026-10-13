# Test strategy and evidence

For results, evaluation, limitations and next steps, see [evaluation.md](evaluation.md).

Four levels of testing, each answering a different question. All automated suites run on every push
in GitHub Actions ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

| Level | Question it answers | Tooling | Where | Count |
|---|---|---|---|---|
| Unit | Does each class follow its rules in isolation? | xUnit; SQLite in-memory; fake AI | `AP-Server-Tests/Unit`, `AP-Server-Tests/*.cs` | 149 server tests |
| Integration | Does the running application behave correctly over HTTP? | xUnit + `WebApplicationFactory` (the real pipeline, EF Core, rate limiting, SignalR) | `AP-Server-Tests/Integration` | 21 server tests |
| Client | Do the UI components and API client behave correctly? | Vitest + Testing Library | `ap-master.client/src/**/*.test.ts(x)` | 152 client tests |
| System | Does the built container start and answer a chat message? | Docker + curl, in CI | `docker` job in `ci.yml` | smoke test |
| Load | Is concurrency controlled under simultaneous users? | `tools/load_test.py` | [load-test.md](load-test.md) | 4 scenarios |
| Real-AI scenarios | Does the live model behave as the design assumes? | `tools/ai_smoke_test.py` | [evaluation.md](evaluation.md) § 2.3 | 16 checks |
| Acceptance | Does it meet the user stories for a real user? | Manual script | [user-acceptance-tests.md](user-acceptance-tests.md) | 12 cases |

Coverage, measured by Coverlet over hand-written code with generated migrations excluded:
- **Server:** 94.6 % of lines and 82.6 % of branches.
- **Client:** 86.4 % of statements.

## Running the tests

```bash
dotnet test AP-Server-Tests                          # server: unit + integration
cd ap-master.client && npm test                      # client
cd ap-master.client && npm run test:coverage         # client with coverage
dotnet test AP-Server-Tests --collect "XPlat Code Coverage" --settings AP-Server-Tests/coverage.runsettings
```

## Design decisions

- **Real database, not mocks.** Service and workflow tests use SQLite in memory, with the real schema,
  constraints and SQL translation. The integration tests use a temporary SQLite file and the real
  start-up migrations. That catches mapping and query mistakes a mocked repository would hide.
- **Only the AI is faked.** `ScriptedAIService` returns scripted replies, adds a delay, or fails on
  demand. That makes every workflow deterministic and lets the tests cover AI-outage paths that can't
  be reproduced reliably against the real provider. The fake still sits behind the real
  concurrency-limiting decorator.
- **Concurrency tests check the race exists.** The duplicate-ticket test was run with the
  per-conversation lock removed and failed with 2 tickets. With the lock, it passes with exactly 1.
- **Each test sets up its own data.** Integration tests create their own customers, so they don't
  depend on each other or on execution order.

## Traceability to user stories

| Story | Automated evidence |
|---|---|
| 1. Customer enquiries | `ChatServiceTests.Enquiry_*`: AI answer, history sent on follow-ups, fallback when the AI is down. `ApiTests.Chat_ConversationIsPersistedAndReadable`. `RuleBasedClassifierTests`, `ClassificationServiceTests` |
| 2. Technical support | `ChatServiceTests.TechnicalSupport_*`: ticket raised and escalated, no duplicates, out-of-scope refused. `ApiTests.Chat_TechnicalSupport_AppearsInTheStaffTicketQueue`, `ApiTests.Ticket_StaffWorkflow_*`. `StaffHubTests`: ticket pushed to staff in real time. Client `TicketsPanel.test.tsx`: live arrival, filters, escalation, transcript |
| 3. Service issues | Client `ChatView.test.tsx`: Yes/No quick replies. `ChatServiceTests.ServiceIssue_*`: steps plus confirmation prompt, "No" raises a ticket, "Yes" resolves, missing details are asked for, and a ticket is raised straight away if the AI is down. `TroubleshootingOutcomeDetectorTests` |
| 4. Complaints | `ChatServiceTests.Complaint_*`: details collected first (even when they mention a fault), CMP reference, severity and escalation, session ended. `TicketServiceTests` (severity and category rules). `ComplaintDetailsTests`. `ApiTests.Chat_Complaint_IsListedAsAComplaintTicket`, `ApiTests.Chat_AfterAComplaintIsLogged_TheConversationIsClosed`. Client `ChatView.test.tsx`: notice, session end |
| 5. IoC | `ClassificationServiceTests` (fake `IAIService` injected). `TelegroupApiFactory` swaps the AI provider through DI. `ConcurrencyLimitedAIServiceTests` (decorator) |
| 6. Concurrency | `ConcurrencyTests` (simultaneous messages, many customers). `KeyedLockTests`. `ConcurrencyLimitedAIServiceTests`. `RateLimitingTests`. [Load test](load-test.md) |
| 7. Security and quality | `ApiTests` (400 / 404 / 409 as ProblemDetails with a `traceId`, security headers, unknown routes). `ChatServiceTests.AnotherCustomersConversation_IsReportedAsNotFound`. `DatabaseSetupTests`. CI on every push |
