"""Check the nginx request limits of a running OpenQZ (production build, frontend/nginx.conf).

    python -I scripts/security/rate_limit_check.py http://localhost:8096 admin@openqz.dev 'password'

Fires bursts from this one machine and counts the answers. Expected: the first requests are
answered, then 429 (Too Many Requests) once a burst passes its limit:
  - anonymous calls: 30 per second per address, bursts up to 300
  - one signed-in user: 20 per second, bursts up to 80
Run it against a test stack only: it briefly locks this machine's address out of the API.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8096"
EMAIL = sys.argv[2] if len(sys.argv) > 2 else "admin@openqz.dev"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin2026Secure"


def call(path: str, headers: dict[str, str] | None = None) -> int:
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


def burst(label: str, path: str, n: int, headers: dict[str, str] | None = None) -> Counter[int]:
    t = time.time()
    with ThreadPoolExecutor(max_workers=64) as pool:
        codes = Counter(pool.map(lambda _: call(path, headers), range(n)))
    print(f"{label}: {n} requests in {time.time() - t:.1f} s -> {dict(sorted(codes.items()))}")
    return codes


def main() -> int:
    body = json.dumps({"email": EMAIL, "password": PASSWORD, "privacy_accepted": True}).encode()
    req = urllib.request.Request(
        BASE + "/api/v1/auth/login", data=body, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        token = json.load(r)["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    user = burst("one signed-in user", "/api/v1/auth/me", 300, auth)
    time.sleep(6)  # let the user's bucket refill before the next burst
    anon = burst("anonymous, one address", "/api/v1/health", 900)
    ok = user[200] >= 60 and user[429] > 0 and anon[200] >= 250 and anon[429] > 0
    print("limits work" if ok else "LIMITS DID NOT TRIGGER AS EXPECTED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
