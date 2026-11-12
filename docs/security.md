# Security

## Reporting a problem

Found a security issue? Do **not** open a public issue. Report it privately through GitHub (Security tab, **Report a vulnerability**) as described in [SECURITY.md](../SECURITY.md). We reply within 3 working days.

## What we protect and from whom

| Asset | Threat | Controls |
| --- | --- | --- |
| Accounts | password guessing, credential stuffing | Argon2id hashes; lockout after 5 failures (15 min); rate limit per real client address in the API (Redis, 60/min) and nginx (`limit_req`, 60/min, burst 30); same error and timing for unknown email and wrong password |
| Client address | spoofing to dodge rate limits | the TLS edge overwrites `X-Real-IP` with the connecting address; nginx and the API use only that header and ignore the client-controlled `X-Forwarded-For` |
| Sessions | token theft | 15 min access JWT kept in memory (not localStorage); refresh token in `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`, stored hashed, rotated on every use; reuse of an old refresh token revokes the whole family |
| First passwords | lost credential slip | forced change at first sign-in; Google sign-in cancels an unused temporary password; slips can be deleted from the server after printing |
| Password reset | account takeover, email enumeration | single-use tokens, stored hashed, 30 min expiry, all other tokens burned on use, sessions revoked; identical response for known / unknown emails; 3 requests per email per hour |
| Google sign-in | forged identity | ID token signature checked against Google's keys, audience = our client id, issuer, expiry, `email_verified`; only pre-imported emails; Google `sub` pinned on first use; optional domain allow-list |
| Answer keys | cheating | keys never leave the server (questions are stripped before sending); attempts use a server-side snapshot; timers enforced on the server with 5 s grace |
| Exams | leaving the page | tab / app switch, focus loss, Back, reload and fullscreen exit are counted server side; auto-submit at the teacher's limit. A browser cannot block screenshots; this is documented to faculty |
| Uploads | malicious files | type detected from file bytes (PNG, JPEG, GIF, WebP only), 5 MB limit, random file names, served with `nosniff` and only to signed-in users; import sheets limited to `.csv` / `.xlsx`, 10 MB |
| Authorisation | horizontal access | role checks on every route; faculty see only their own activities and sections they teach; club organisers see only their own activities and rooms, never class lists; students see only their own attempts |
| Room codes | guessing a code to get into someone else's room | 6 random digits from `secrets`; joins limited to 20 tries per minute per user; host can stop joins or rotate the code; joining needs a signed-in account and is recorded as a normal target |
| Browser | XSS, clickjacking | React escaping; CSP `default-src 'self'` with no inline scripts; `frame-ancestors 'none'`; `X-Frame-Options DENY`; `nosniff`; `Referrer-Policy`; `Permissions-Policy`; COOP / CORP |
| Password reset endpoints | hammering | "forgot" and "use a reset link" are limited to 20 a minute per client address in nginx and in the API; each email address gets at most one reset email a minute, 3 an hour and 6 a day (windows start at the first request) |
| API surface | reconnaissance | Swagger (`/api/docs`) and `/api/openapi.json` answer 404 on staging and production; nginx refuses them too |
| Cross-origin | another site reading or embedding our data | CORS only for the exact https origins in `CORS_ORIGINS` (the API refuses to start with `*` or `http://` on staging / production); API answers carry `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: default-src 'none'`; the refresh cookie is `SameSite=Strict` |
| Reporting | no way to reach us | `/.well-known/security.txt` (RFC 9116; renew its `Expires` line in `frontend/nginx.conf` once a year), `robots.txt` keeps signed-in areas and the API out of search engines |
| Deleting data | a stolen or unattended admin session wiping work; a slip of the finger | admin role only; each delete needs the admin's password again in the same request and the name typed out; 5 wrong passwords lock deleting for 10 minutes per admin; no self-delete, no deleting the last admin; the audit log records every delete (with counts of what went) and every refused try |
| Transport | sniffing | TLS at the edge (Let's Encrypt), HSTS one year |
| Accountability | misuse | audit log of sign-ins, failures, lockouts, resets, imports, credential downloads, assignments and score releases |
| Dependencies | known CVEs | pip-audit and pnpm audit block CI |

## Latest results (2026-11-08)

| Check | Result |
| --- | --- |
| OWASP ZAP baseline (production build) | **0 failures**, 64 rules passed, 4 warnings, all accepted below. Report: [reports/zap-baseline-2026-11-08.html](reports/zap-baseline-2026-11-08.html) |
| pip-audit (46 installed backend packages) | no known vulnerabilities |
| pnpm audit (production dependencies) | no known vulnerabilities |
| axe-core accessibility | no serious or critical issues |

Accepted ZAP warnings:

| Warning | Why accepted |
| --- | --- |
| CSP `style-src 'unsafe-inline'` | Needed for the answer tile colours and Google's sign-in button. Scripts stay strict (no inline scripts), which is where XSS risk lives. |
| Cross-Origin-Embedder-Policy missing | `require-corp` would break the Google sign-in iframe. |
| Cross-Origin-Opener-Policy not `same-origin` | `same-origin-allow-popups` is set so the Google sign-in popup works. |
| Modern web application / cacheable content | Informational. |

## Fixed during hardening (2026-11-08)

| Finding | Impact | Fix |
| --- | --- | --- |
| The web nginx rate-limited by its own peer address, which behind the edge is the same for everyone | the 10/min login limit applied to the whole site; a lab of students signing in together would be refused | limit by the real client address (`X-Real-IP` from the edge), 60/min per address |
| The API took the first `X-Forwarded-For` entry as the client | a client could send a fake header to dodge the per-address limit | only `X-Real-IP`, set by our edge, is trusted |
| Badge text contrast below WCAG AA | hard to read | darker text colour |

## Re-running the checks

```bash
# ZAP baseline against a running production build on port 8090
docker run --rm -v "$PWD/docs/reports:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:8090/login -r zap-baseline-$(date +%F).html -I \
  -z "-config replacer.full_list(0).description=host -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Host -config replacer.full_list(0).replacement=localhost"
```

The `replacer` options send `Host: localhost`, which the API's trusted-host check accepts.

## Secrets

- `.env*` files are never committed; production files are `chmod 600`.
- `JWT_SECRET` is different per environment; rotating it signs everyone out.
- No secrets in logs; tokens are stored only as hashes.
