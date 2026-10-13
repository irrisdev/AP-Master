# Load test: concurrency control under simultaneous users

**Run on:** 12 October 2026, Apple M1 Pro (8 cores), macOS. Server built from `feature/technical-hardening`,
running in the Production environment with the placeholder AI provider.
**Tool:** [`tools/load_test.py`](../../tools/load_test.py), Python standard library only.

## Purpose

User story 6 asks that, under spikes in concurrent users, messages are handled asynchronously. The
rubric asks for *deliberate* concurrency control rather than incidental `async`. This test shows
four mechanisms working on a running server:

| Mechanism | Where | What it protects |
|---|---|---|
| Async request handling | Every controller, service and EF Core call | Threads are not blocked while waiting on the AI or database, so many requests overlap. |
| AI concurrency limit (`AIRequestGate`, a `SemaphoreSlim`) | `ConcurrencyLimitedAIService`, a decorator around `IAIService` | The AI provider never receives more than *N* calls at once. Requests that can't get a slot within the queue timeout use their non-AI fallback reply instead of failing. |
| Per-client rate limits (token bucket) | ASP.NET Core rate-limiting middleware | One client cannot monopolise the server. Excess requests get `429` with `Retry-After`. |
| Per-conversation lock (`ConversationLocks`) | `ChatService` | Two messages racing into the same conversation can't both create a ticket. Proven by `ConcurrencyTests.SimultaneousMessagesToOneConversation_RaiseExactlyOneTicket`: with the lock removed, the same test creates 2 tickets. |

## Method

- Each scenario starts the server on a fresh SQLite database.
- The placeholder AI is given an 800 ms delay (`AI__DummyLatencyMilliseconds=800`) so it behaves like
  a real provider.
- Scenarios A–C raise the rate limits so that only the AI limit is being observed.
- Each request is a customer enquiry ("What are your opening hours?"). The rule-based classifier
  handles that, so each request makes exactly one AI call.
- While the requests run, the script polls `/health` every 100 ms to record how many AI calls are in
  flight.

```bash
# server (one scenario; change the AI__ and RateLimiting__ values per the table below)
AI__ApiKey= AI__DummyLatencyMilliseconds=800 AI__MaxConcurrentRequests=4 AI__QueueTimeoutSeconds=10 \
  dotnet run --project AP-Master.Server --urls http://localhost:5198

# load
python3 tools/load_test.py --base-url http://localhost:5198 --requests 40 --concurrency 40
```

| Scenario | AI slots | Queue timeout | Rate limits |
|---|---|---|---|
| A | 64 | 10 s | raised |
| B | 4 | 10 s | raised |
| C | 4 | 2 s | raised |
| D | 4 (default) | 10 s (default) | **default**: 15-message burst, then 5 per 20 s |

## Results

## A. Asynchronous overlap: 40 customers at once, AI limit raised to 64

| Metric | Value |
|---|---|
| Requests / concurrency | 40 / 40 |
| Status codes | 200: 40 |
| Replies that used the non-AI fallback | 0 |
| Wall-clock time | 1.91 s |
| Throughput | 20.9 requests/s |
| Latency of 200s: p50 / p95 / max | 1.06 s / 1.76 s / 1.91 s |
| Sum of 200 latencies (if run one at a time) | 45.90 s |
| Peak AI calls in flight (sampled from /health) | 38 of 64 |
| /health statuses seen | Healthy: 17 |

## B. AI concurrency limit: 40 customers at once, 4 AI slots, 10 s queue

| Metric | Value |
|---|---|
| Requests / concurrency | 40 / 40 |
| Status codes | 200: 40 |
| Replies that used the non-AI fallback | 0 |
| Wall-clock time | 8.41 s |
| Throughput | 4.8 requests/s |
| Latency of 200s: p50 / p95 / max | 4.26 s / 8.26 s / 8.41 s |
| Sum of 200 latencies (if run one at a time) | 183.21 s |
| Peak AI calls in flight (sampled from /health) | 4 of 4 |
| /health statuses seen | Healthy: 4, Degraded: 74 |

## C. Saturation: 40 customers at once, 4 AI slots, 2 s queue

| Metric | Value |
|---|---|
| Requests / concurrency | 40 / 40 |
| Status codes | 200: 40 |
| Replies that used the non-AI fallback | 24 |
| Wall-clock time | 3.34 s |
| Throughput | 12.0 requests/s |
| Latency of 200s: p50 / p95 / max | 2.18 s / 3.33 s / 3.34 s |
| Sum of 200 latencies (if run one at a time) | 90.02 s |
| Peak AI calls in flight (sampled from /health) | 4 of 4 |
| /health statuses seen | Healthy: 1, Degraded: 29 |

## D. Rate limiting: one customer sends 30 messages at once (default limits)

| Metric | Value |
|---|---|
| Requests / concurrency | 30 / 30 |
| Status codes | 200: 15, 429: 15 |
| Replies that used the non-AI fallback | 0 |
| Wall-clock time | 3.45 s |
| Throughput | 8.7 requests/s |
| Latency of 200s: p50 / p95 / max | 1.69 s / 3.29 s / 3.44 s |
| Sum of 200 latencies (if run one at a time) | 30.32 s |
| Peak AI calls in flight (sampled from /health) | 4 of 4 |
| /health statuses seen | Healthy: 9, Degraded: 23 |


## What the results show

- **A: requests overlap rather than queue behind each other.** 40 requests that each spend 0.8 s
  waiting on the AI took 46 s of total latency, but only 1.9 s of wall-clock time. Up to 38 AI calls
  were in flight at once. This is the asynchronous behaviour story 6 asks for.
- **B: the AI limit holds exactly.** Never more than 4 AI calls ran at once, however many customers
  were waiting. The wall-clock time of 8.4 s matches the theory: 40 calls × 0.8 s ÷ 4 slots = 8 s.
  Every customer still got an AI reply. `/health` reported `Degraded` while all slots were busy, so
  monitoring can see the saturation.
- **C: latency stays bounded when the provider is saturated.** With a 2 s queue timeout, 16 customers
  got AI replies and 24 got the non-AI fallback reply. No request waited longer than 3.4 s, and none
  failed. The queue timeout is the trade-off between waiting for the AI and answering quickly.
- **D: one client cannot flood the API.** The first 15 messages (the burst allowance) were accepted
  and the other 15 were rejected immediately with `429` and a `Retry-After` header. The accepted 15
  still passed through the 4-slot AI limit.

## Limits of this test

- It runs on one machine against one server process, with a simulated AI, and the client and server
  share the CPU. It shows the control mechanisms working; it is not a capacity benchmark.
- The per-conversation lock and the AI limit are in-process. Several server instances would need a
  shared store, such as a database lock or Redis, and a reverse proxy in front would need
  `ForwardedHeaders` so the rate limiter sees real client IPs.
- SQLite allows one writer at a time. EF Core waits on its busy timeout, so this was not a bottleneck
  at this load, but a production deployment would move to PostgreSQL or SQL Server.
