# Testing and evaluation

How the Telegroup customer service chatbot was tested, what the results show, where it falls
short, and what we would do next. Results are as of 13 October 2026, on `master` at `629199d`.

Related documents:
- [Test strategy and traceability](test-strategy.md): how each level of testing works, and which
  tests cover which user story.
- [Load test](load-test.md): the concurrency measurements in full.
- [User acceptance test script](user-acceptance-tests.md): the manual test cases.
- [Evidence](evidence/): raw results from the real-AI scenario runs.

---

## Summary

| Area | Result |
|---|---|
| Server automated tests | **170 passing**: 149 unit and 21 integration. **94.6 %** line and **82.6 %** branch coverage, generated code excluded |
| Client automated tests | **152 passing**, **86.4 %** statement coverage. Lint and type-check clean |
| Continuous integration | Every push builds both halves, runs all tests, then builds and smoke-tests the Docker image |
| Concurrency and load | 40 simultaneous customers served in 1.9 s; the AI-call cap held exactly; rate limiting rejected the excess |
| Real-AI scenario tests | Claude Haiku 5.5 on the final code: **16 / 16** checks passed, with **no prompt-rule breaches**. A free model on the earlier code: 13 / 16, which exposed 3 bugs |
| User acceptance testing | Script prepared; results to be recorded (see [section 2.4](#24-user-acceptance-testing)) |
| Defects found by testing | 12, all fixed (see [section 4](#4-what-testing-found)) |

---

## 1. Strategy

The question to answer was whether each part of the system behaves correctly, and whether the whole
thing works for a real customer and agent. Each level of testing answers a different part of that:

| Level | What it answers | How |
|---|---|---|
| **Unit** | Does each class follow its rules in isolation? | xUnit and Vitest. Services run against a real in-memory SQLite database; only the AI is faked |
| **Integration** | Does the running application behave correctly over HTTP? | `WebApplicationFactory` hosts the real pipeline: routing, validation, middleware, EF Core, rate limiting and SignalR |
| **System** | Does the built container start and work? | CI builds the Docker image, starts it, and calls `/health`, the web page and the chat API |
| **Load** | Are simultaneous users handled under control? | `tools/load_test.py` against a running server |
| **Real-AI scenarios** | Does the live model behave as the design assumes? | `tools/ai_smoke_test.py`: 15 scripted conversations against the deployed app and a real model |
| **User acceptance** | Does it meet the user stories for real people? | A manual script with expected results, run by testers |

Two design choices shaped the automated tests:
- **Real database, fake AI.** A real database catches mapping and query mistakes that a mock would
  hide. Faking only the AI makes every workflow repeatable, and lets us test AI failures (timeouts,
  empty replies, outages) on demand.
- **Tests must prove they can fail.** For example, the duplicate-ticket test was run with the
  per-conversation lock removed. It failed with 2 tickets, so we know it really guards the race.

## 2. Results

### 2.1 Automated tests

| Suite | Tests | Coverage |
|---|---|---|
| Server: unit | 149 | 94.6 % of lines and 82.6 % of branches across the server |
| Server: integration | 21 | (included above) |
| Client | 152 | 86.4 % of statements, 82.7 % of branches |

All tests pass locally and in CI. The server unit tests cover:
- the four chat workflows end to end against a real database
- ticket business rules (severity, category, escalation, status transitions)
- the classifier and the troubleshooting outcome detector
- conversation history trimming
- the AI client's retry behaviour, using a scripted HTTP handler
- the concurrency primitives
- reply sanitising
- the package catalogue

The integration tests cover:
- validation errors
- not-found and conflict responses
- security headers
- rate limiting
- the SignalR ticket feed
- simultaneous requests to one conversation

Coverage is high but not a goal in itself. The untested lines are mostly the real HTTP AI client's
success path, which is exercised by the real-AI scenarios instead (section 2.3).

### 2.2 Concurrency and load

Measured on one machine, with a simulated AI that takes 0.8 s per call. Full method in
[load-test.md](load-test.md).

| Scenario | Result | What it shows |
|---|---|---|
| A. 40 customers at once | 1.9 s wall-clock for 45.9 s of combined AI waiting | Requests overlap; nothing blocks a thread |
| B. AI limited to 4 slots | Exactly 4 of 4 in use; all 40 answered in 8.4 s (theory: 8 s) | The concurrency cap holds |
| C. 4 slots, 2 s queue timeout | 16 got AI replies, 24 got the fallback; none waited over 3.4 s | Latency stays bounded when saturated |
| D. One client sends 30 at once | 15 accepted, 15 rejected with 429 and `Retry-After` | One client can't flood the API |

### 2.3 Real-AI scenario testing

The automated tests fake the AI, so they can't tell us how a real model behaves. We ran 15 scripted
conversations (16 checks) against the deployed app. They cover every workflow, plus out-of-scope
requests, prompt injection, a follow-up that needs context, an ambiguous message, and a closed
conversation. Each check verifies routing, ticket creation and conversation status, and every reply
is saved for review.

**Two runs, not a clean comparison.** The first run used a free model against the original code, and
its three failures were code bugs that the model's behaviour exposed. We fixed them, then ran Claude
Haiku 5.5 against the fixed code. The improvement therefore comes from both the fixes and the model.
A second free-model run on the fixed code was cut short when the free tier's 50-requests-a-day quota
ran out. Both runs took place before the package catalogue was added to the enquiry prompt, so
check 2 shows the model *declining* to quote prices; re-running the scenarios would show grounded
prices instead.

| Check | Free model (original code) | Claude Haiku 5.5 (final code) |
|---|---|---|
| Enquiry answered, and follow-up uses context | Pass | Pass |
| Out-of-scope request refused, no ticket | Pass | Pass |
| Technical support raises a ticket; follow-up reuses it | Pass | Pass |
| Service issue gives steps and asks whether they worked | **Fail**: empty AI reply, so a ticket was raised straight away | Pass |
| "No, still not working" raises a ticket | **Fail**: restarted troubleshooting instead | Pass |
| "Yes, that fixed it" resolves the conversation | **Fail**: model asked and gave steps together | Pass |
| Vague issue asks for details first | Pass | Pass |
| Complaint: details asked for, logged, session ended | Pass | Pass |
| High-severity complaint escalated | Pass | Pass |
| Prompt injection refused | Pass | Pass |
| Ambiguous message classified | Pass (fallback to rules) | Pass (AI classified it as technical support) |
| Message to a closed conversation refused (409) | Pass | Pass |
| **Total** | **13 / 16** | **16 / 16** |

**Prompt-rule compliance.** Every saved reply was checked against the rules in the system prompts:

| Rule | Free model | Claude Haiku 5.5 |
|---|---|---|
| No invented prices | Broken: quoted "£46.99/month" with no catalogue | Kept |
| No timescale promises | Broken: "within 1–2 business days" | Kept: declined to confirm a visit time |
| Plain text, no markdown | Broken: `**bold**` headings | Kept |
| No internal status names | Broken: "AwaitingTechnician" | Kept |
| No questions after the conversation closes | Broken: asked for an account number | Kept |

**Latency** (median and maximum of AI-backed turns, from a single run each):

| Model | Median | Max |
|---|---|---|
| Free model | 3.5 s | 14.4 s |
| Claude Haiku 5.5 | 2.0 s | 6.2 s |

**Degraded mode.** When the free model's quota ran out mid-run, every request still received a
polite reply (HTTP 200), and the closed-conversation check still returned 409. No request failed.

### 2.4 User acceptance testing

The script in [user-acceptance-tests.md](user-acceptance-tests.md) has 12 functional cases mapped to
the user stories, plus 4 non-functional checks (rate limiting, AI outage, phone-sized screen,
keyboard-only use). It should be run with at least three testers, at least one from outside the
team, and the actual results recorded in the script.

| Tester | Date | Cases passed | Notes |
|---|---|---|---|
| | | / 16 | |
| | | / 16 | |
| | | / 16 | |

---

## 3. Evaluation against requirements

### Functional (user stories)

| # | Story | Verdict | Evidence |
|---|---|---|---|
| 1 | Customer enquiries | **Met** | `ChatServiceTests.Enquiry_*`; real-AI checks 1–2 and 13; catalogue grounding unit-tested (`PackageCatalogueServiceTests`) |
| 2 | Technical support | **Met** | Ticket raised and pushed to staff live (`StaffHubTests`); real-AI checks 4–5 |
| 3 | Service issues | **Met** | Steps, then Yes resolves and No raises a ticket (`ChatServiceTests.ServiceIssue_*`); real-AI checks 6–8 |
| 4 | Complaints | **Met** | Details collected, `CMP-` reference, severity and escalation, session ended; real-AI checks 10–12 and 15 |
| 5 | Architecture (IoC) | **Met** | AI provider swapped from a free model to Claude Haiku 5.5 by configuration alone, with no code change |
| 6 | Concurrency | **Met** | Load test A–D; `ConcurrencyTests`, `KeyedLockTests` |
| 7 | Security and quality | **Partial** | Validation, error handling, headers, rate limits and CI are in place; there is no authentication (see limitations) |

### Non-functional

| Quality | Evaluation |
|---|---|
| **Performance** | Haiku-backed turns take a median of 2.0 s (6.2 s worst observed); rule-only turns are immediate. Acceptable for chat, though streaming would feel faster. |
| **Reliability** | Every AI failure mode we met — empty replies, rate limits, an exhausted quota — produced a safe reply rather than an error. Transient failures are retried once. |
| **Scalability** | Proven to overlap and cap work within one server instance. Not proven across instances (see limitations). |
| **Security** | Input validation, ownership checks, standard error responses that never leak internals, security headers, restricted CORS, rate limits, and secrets kept out of the repository. No authentication. |
| **Maintainability** | High automated coverage, interface-based design, and documented architecture. The provider swap and a teammate adding the package catalogue both landed without touching unrelated code. |
| **Usability** | To be confirmed by user acceptance testing. |

---

## 4. What testing found

Testing earned its keep: it found 12 defects, all of which were fixed.

| How it was found | Defect |
|---|---|
| Integration tests | Validation errors were returned as plain JSON, not the standard problem format used everywhere else |
| Concurrency test | Two simultaneous messages could both raise a ticket (proved by removing the lock: 2 tickets) |
| Client tests against the mock | Complaint details that mentioned an engineer or a fault were routed as a new support ticket instead of being logged as the complaint |
| End-to-end check in the browser | Complaints about engineers were categorised as "General" |
| End-to-end check in the browser | Dashboard filter fields stretched to full width (a CSS ordering bug) |
| Deployment review | The Docker image was built with the offline demo client, not the live one |
| Running the container | The app couldn't read its settings file because of host file permissions |
| Real-AI scenarios | An empty reply from the model skipped troubleshooting and raised a ticket immediately |
| Real-AI scenarios | "Still not working" after a ticket had been raised restarted troubleshooting |
| Real-AI scenarios | A reply that both asked a question and gave steps never entered troubleshooting |
| Real-AI scenarios | Five prompt-rule breaches: markdown, an invented price, a timescale, a raw status name, a question after closing |
| Real-AI scenarios | Retrying a rate-limited (429) request wasted quota |

**Lesson.** Every automated test passed before the real-AI run, yet that run found the most
important problems. Faking the AI makes tests repeatable, but it only proves the code handles the
behaviour we *expected*. Model behaviour has to be tested against the real model, and the app must
check the model's output rather than trust it. That led to the reply sanitising and the step
detection now in the code.

---

## 5. Limitations

These are accepted for this prototype. Each is documented, and the impact is contained as described.

| Limitation | Impact | What contains it today |
|---|---|---|
| **No authentication or authorisation** | The customer ID in a chat request is trusted, and the staff dashboard and its API are open to anyone who can reach them | Customers can only reach their own conversations; the boundary is stated in the README |
| **Small, single-run AI evaluation** | 16 checks run once per model. Model output varies between runs, so a pass is evidence, not proof | Deterministic business rules; replies sanitised and checked; safe fallbacks |
| **Confounded model comparison** | The free-model and Haiku runs used different code, so the gain can't be attributed to the model alone | Stated plainly in section 2.3 |
| **Single-server concurrency controls** | The conversation lock, AI cap and rate limits live in one process, so running several instances would bypass them | One instance is enough for the expected load; documented in the load test |
| **SQLite** | One writer at a time; not suited to high write volume | Adequate at prototype scale; EF Core makes moving to PostgreSQL straightforward |
| **Load test used a simulated AI on one machine** | Shows the controls work, not real-world capacity or the provider's own limits | Results are framed as behaviour, not capacity |
| **Degraded mode loses out-of-scope detection** | With the AI down, "send an engineer for my boiler" becomes a ticket, because the out-of-scope check needs the AI | Staff can close such tickets; it only happens during an outage |
| **Keyword classifier is English-only** | Misspellings or other languages lean on the AI, so they're less reliable when it is unavailable | The AI handles ambiguous messages when available |
| **Rate limiting by client IP** | Users behind one shared network share a limit; behind a reverse proxy, every request looks like the same IP | Generous limits; forwarded-header support noted as needed for production |
| **No browser end-to-end tests** | The UI is covered by component tests and manual checks only | The API it depends on is integration-tested |
| **Third-party AI processing** | Customer messages and recent history are sent to an external provider | Data is fictional; a data-handling note is in the README |

---

## 6. Recommended enhancements

In priority order, with rough effort (S = days, M = 1–2 weeks, L = several weeks). None are
implemented; they are the next steps if the project continued.

| # | Enhancement | Addresses | Effort |
|---|---|---|---|
| 1 | **Sign-in and roles** with ASP.NET Core Identity or an external identity provider, with a staff role protecting the dashboard API and the SignalR hub | No authentication | M |
| 2 | **A proper AI evaluation suite**: a larger labelled set of conversations, several runs per case with a pass-rate threshold, rubric scoring for tone and policy, and a scheduled CI job with a cost cap | Small, single-run AI evaluation | M |
| 3 | **Browser end-to-end tests** with Playwright for the main customer and staff journeys | No browser end-to-end tests | S |
| 4 | **Horizontal scaling**: PostgreSQL, plus Redis for the lock and rate limits, behind a load balancer with forwarded headers | Single-server controls; SQLite; IP-based limits | L |
| 5 | **Streaming replies** so text appears as it is generated | Perceived latency | S |
| 6 | **Observability**: OpenTelemetry tracing and dashboards for AI latency, fallback rate and ticket volume | Tracking AI behaviour in production | M |
| 7 | **A rule-based out-of-scope check** for when the AI is unavailable | Degraded-mode tickets | S |
| 8 | **Data protection controls**: retention periods, customer data export and erasure, and a processing agreement or self-hosted model | Third-party processing | M |

---

## 7. Evidence index

| Evidence | Location |
|---|---|
| Test strategy and story traceability | [test-strategy.md](test-strategy.md) |
| Load test method and results | [load-test.md](load-test.md) |
| User acceptance test script | [user-acceptance-tests.md](user-acceptance-tests.md) |
| Real-AI run, free model (original code) | [evidence/ai-scenarios-free-model.json](evidence/ai-scenarios-free-model.json) |
| Real-AI run, Claude Haiku 5.5 (final code) | [evidence/ai-scenarios-claude-haiku-5.5.json](evidence/ai-scenarios-claude-haiku-5.5.json) |
| Scenario test tool | [`tools/ai_smoke_test.py`](../../tools/ai_smoke_test.py) |
| Load test tool | [`tools/load_test.py`](../../tools/load_test.py) |
| CI workflow | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| Server tests | `AP-Server-Tests/Unit`, `AP-Server-Tests/Integration` |
| Client tests | `ap-master.client/src/**/*.test.ts(x)` |
