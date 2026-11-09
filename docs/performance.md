# Performance

Target from the Implementation Plan (M3 quality gate): **p95 below 300 ms with 300 students at once.**

## Scenario

`tests/load/student-exam.js` (k6) models the real peak: a whole year group sitting the same quiz.

- 300 students join within 30 s, then work for 90 s.
- Each opens their activity list, starts the quiz, and for each of 10 questions loads it, thinks 1 to 3 s, and saves an answer, then submits.
- Uses pre-issued tokens (`python -m app.loadseed`), so the login rate limiter does not distort the result.

## Results (2026-11-08, developer laptop)

Production images (`compose.prod.yaml`, 8 gunicorn workers, API capped at 8 CPUs) on Docker Desktop with 12 logical CPUs and 8 GB, **shared with k6 and Postgres on the same machine**.

| Students at once | Requests/s | Median | p95 | Errors | Target met |
| --- | --- | --- | --- | --- | --- |
| 100 | 85 | 34 ms | 95 ms | 0% | yes |
| 200 | 157 | 68 ms | 362 ms | 0% | nearly |
| 300 | 154 (saturated) | 581 ms | 1.35 s | 0% | no |

The laptop saturates at about 155 requests/s, while 300 students generate about 230/s. Idle, each exam request takes 20 to 50 ms. **The target must be confirmed on the CSE server** (2 x Xeon, 256 GB). Run the steps below there before M3.

Issues found and fixed during these tests:

| Finding | Fix |
| --- | --- |
| 36% of requests failed with `too many clients` once 8 workers x 30 connections exceeded Postgres's 200 | connection pool configurable, default 5 + 5 per process (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`); formula in the runbook |
| nginx kept a dead container address after the API was recreated (502s during deploys) | nginx re-resolves service names through Docker DNS every 10 s |
| The student home page loaded every saved answer of every attempt | listing loads summary columns only (`raiseload` / `defer`); full rows only when an attempt must be auto-submitted |
| Each answer save loaded the activity's live question list | attempt requests load only the attempt, its answers and assignment settings |

## Running it on the server

```bash
# 1. a production-like stack on the server (staging is fine)
docker compose -p openqz-staging exec -T api python -m app.loadseed --students 300 --out /data/media/load-tokens.json
docker cp openqz-staging-api-1:/data/media/load-tokens.json tests/load/load-tokens.json

# 2. run k6 from another machine on the campus network if possible
docker run --rm -i -v "$PWD/tests/load:/scripts" \
  -e BASE=https://staging.openqz.dbit.co.in -e HOST=staging.openqz.dbit.co.in \
  grafana/k6:0.55.0 run /scripts/student-exam.js

# 3. remove the load-test data afterwards (LOAD department, LOAD* users) or reset staging
```

`loadseed` refuses to run when `ENVIRONMENT` is `production` or `staging`. For the run, set `ENVIRONMENT=development` temporarily on the staging stack, or run it on a copy.

## Page speed on phones (Web Vitals)

Measured on the **production build** (`KEEP=1 SKIP_E2E=1 scripts/prod_smoke.sh`, then `node scripts/web_vitals.mjs`) in Playwright's Chromium, emulating a Pixel 7 on **slow 4G** (150 ms round trip, 1.6 Mbps) with a **4x slower CPU**, the same conditions Lighthouse uses for mobile. Cache disabled; the signed-in pages are repeat visits, so the service worker serves the app files.

| Page | First paint | Largest paint (LCP) | Layout shift (CLS) | Blocking time | Downloaded |
| --- | --- | --- | --- | --- | --- |
| Login, first visit | 2.17 s | 2.17 s | 0.000 | 350 ms | 149 kB (134 kB JS) |
| Student home | 0.37 s | 0.53 s | 0.000 | 0 ms | 5 kB |
| Join with a code | 0.40 s | 0.40 s | 0.000 | 0 ms | 3 kB |
| Faculty home | 0.58 s | 0.58 s | 0.000 | 6 ms | 5 kB |
| Student guide (diagrams) | 0.54 s | 0.54 s | 0.000 | 1.7 s | 736 kB |

Targets (Google "good"): LCP under 2.5 s, CLS under 0.1. All pages meet them. Before gzip was turned on, the login page downloaded 488 kB and its LCP was 3.28 s.

The guide pages spend 1.7 s drawing their Mermaid diagrams on a slow phone. They are reference pages outside the quiz flow, and Mermaid is cached for a week after the first visit.

The same script checks that OpenQZ installs as an app: manifest (name, `standalone`, `start_url`, theme colour), 192, 512 and maskable icons that load, the service worker, and that a reload while offline still shows the app.

```mermaid
flowchart LR
    A["First visit"] -- "HTML + 134 kB JS (gzip)" --> B["Login"]
    B --> C["Service worker caches<br/>the hashed app files"]
    C --> D["Every later page<br/>3 to 5 kB of API data"]
    D -. "app update" .-> E["New hashed files fetched once;<br/>stale tab reloads itself"]
```

## Sizing

| Setting | Laptop test | Suggested for the CSE server |
| --- | --- | --- |
| `WEB_CONCURRENCY` (gunicorn workers) | 8 | 2 x physical cores available to OpenQZ, for example 16 |
| `API_CPUS` | 8 | 16 |
| `DB_POOL_SIZE` + `DB_MAX_OVERFLOW` | 5 + 5 | keep (workers + 1) x 10 below Postgres `max_connections` (200) |
| Postgres `shared_buffers` | 2 GB | 8 GB (edit `compose.prod.yaml`) |

If the p95 target is still missed with more workers, the next steps, in order, are: PgBouncer in transaction mode, caching `/me/activities` per student for a few seconds in Redis, and serving `/api/v1/attempts/*` from a second API replica.
