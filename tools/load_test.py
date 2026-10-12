#!/usr/bin/env python3
"""
Load test for POST /api/chat. Standard library only, so it runs anywhere Python 3.9+ does.

Fires a batch of chat requests concurrently and reports status codes, latency percentiles,
throughput, and (by polling /health) how many AI calls were in flight at the peak.

Examples
  # 40 different customers chatting at once
  python3 tools/load_test.py --base-url http://localhost:5056 --requests 40 --concurrency 40

  # one customer hammering the chat endpoint (shows the per-client rate limit)
  python3 tools/load_test.py --requests 30 --concurrency 30 --same-customer

Run the server with the placeholder AI and an artificial delay to make it behave like a real
provider, for example:
  AI__ApiKey= AI__DummyLatencyMilliseconds=800 dotnet run --project AP-Master.Server
"""
import argparse
import json
import statistics
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor


def request(method, url, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read()
            return response.status, time.perf_counter() - started, payload
    except urllib.error.HTTPError as error:
        return error.code, time.perf_counter() - started, error.read()
    except Exception as error:  # connection refused, timeout
        return f"error: {type(error).__name__}", time.perf_counter() - started, b""


def create_customers(base_url, count):
    ids = []
    for i in range(count):
        status, _, payload = request("POST", f"{base_url}/api/customers",
                                     {"name": f"Load Test {i}", "email": f"load-{uuid.uuid4().hex}@test.example"})
        if status != 201:
            raise SystemExit(f"Could not create customer {i}: HTTP {status} {payload[:200]!r}")
        ids.append(json.loads(payload)["id"])
    return ids


class HealthSampler(threading.Thread):
    """Polls /health while the test runs, recording peak AI concurrency and any Degraded status."""

    def __init__(self, base_url):
        super().__init__(daemon=True)
        self.base_url = base_url
        self.stop = threading.Event()
        self.peak_in_use = 0
        self.capacity = None
        self.statuses = Counter()

    def run(self):
        while not self.stop.is_set():
            status, _, payload = request("GET", f"{self.base_url}/health", timeout=5)
            if status in (200, 503) and payload:
                report = json.loads(payload)
                self.statuses[report["status"]] += 1
                for check in report.get("checks", []):
                    data = check.get("data") or {}
                    if check["name"] == "ai-provider" and "inUse" in data:
                        self.peak_in_use = max(self.peak_in_use, data["inUse"])
                        self.capacity = data["capacity"]
            self.stop.wait(0.1)


def percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct / 100 * len(ordered)) - 1))
    return ordered[index]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:5056")
    parser.add_argument("--requests", type=int, default=40)
    parser.add_argument("--concurrency", type=int, default=40)
    parser.add_argument("--message", default="What are your opening hours?")
    parser.add_argument("--same-customer", action="store_true", help="send every request as one customer")
    parser.add_argument("--label", default="load test")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    customers = create_customers(base_url, 1 if args.same_customer else args.requests)

    sampler = HealthSampler(base_url)
    sampler.start()

    def send(i):
        customer = customers[0] if args.same_customer else customers[i]
        return request("POST", f"{base_url}/api/chat", {"customerId": customer, "message": args.message})

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(send, range(args.requests)))
    elapsed = time.perf_counter() - started

    sampler.stop.set()
    sampler.join()

    statuses = Counter(status for status, _, _ in results)
    ok = [latency for status, latency, _ in results if status == 200]
    fallbacks = sum(1 for status, _, body in results if status == 200 and b"unable to answer" in body)

    print(f"## {args.label}")
    print()
    print("| Metric | Value |")
    print("|---|---|")
    print(f"| Requests / concurrency | {args.requests} / {args.concurrency} |")
    print(f"| Status codes | {', '.join(f'{code}: {count}' for code, count in sorted(statuses.items(), key=str))} |")
    print(f"| Replies that used the non-AI fallback | {fallbacks} |")
    print(f"| Wall-clock time | {elapsed:.2f} s |")
    print(f"| Throughput | {len(results) / elapsed:.1f} requests/s |")
    if ok:
        print(f"| Latency of 200s: p50 / p95 / max | {percentile(ok, 50):.2f} s / {percentile(ok, 95):.2f} s / {max(ok):.2f} s |")
        print(f"| Sum of 200 latencies (if run one at a time) | {sum(ok):.2f} s |")
    if sampler.capacity is not None:
        print(f"| Peak AI calls in flight (sampled from /health) | {sampler.peak_in_use} of {sampler.capacity} |")
    print(f"| /health statuses seen | {', '.join(f'{k}: {v}' for k, v in sampler.statuses.items())} |")


if __name__ == "__main__":
    main()
