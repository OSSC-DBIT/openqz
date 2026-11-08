#!/usr/bin/env bash
# Seed a running stack with the sample faculty, students and mapping (for demos, CI e2e).
# Usage: scripts/seed_demo.sh [base_url] [admin_email] [admin_password]
# The admin must already exist (python -m app.cli create-admin --from-env). If the admin still
# has a temporary password, it is changed to $NEW_ADMIN_PASSWORD (default Admin2026Secure).
set -euo pipefail

BASE="${1:-http://localhost:8088}/api/v1"
ADMIN_EMAIL="${2:-admin@openqz.dev}"
PASS="${3:-ChangeMe@123}"
NEW_PASS="${NEW_ADMIN_PASSWORD:-Admin2026Secure}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {'d': d}))" "$1"; }

login() {
  curl -fsS -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$1\"}"
}

if ! RESP=$(login "$PASS" 2>/dev/null); then
  RESP=$(login "$NEW_PASS")
  PASS="$NEW_PASS"
fi
TOKEN=$(echo "$RESP" | json "d['access_token']")
if [ "$(echo "$RESP" | json "d['user']['must_change_password']")" = "True" ]; then
  TOKEN=$(curl -fsS -X POST "$BASE/auth/change-password" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"current_password\":\"$PASS\",\"new_password\":\"$NEW_PASS\"}" | json "d['access_token']")
  echo "admin password set to \$NEW_ADMIN_PASSWORD"
fi

for kind in faculty students mapping; do
  ID=$(curl -fsS -X POST "$BASE/imports" -H "Authorization: Bearer $TOKEN" \
    -F kind=$kind -F academic_year=2026-27 -F "file=@$HERE/samples/${kind}_sample.csv" | json "d['id']")
  for _ in $(seq 1 30); do
    S=$(curl -fsS "$BASE/imports/$ID" -H "Authorization: Bearer $TOKEN" | json "d['status']")
    [ "$S" = preview ] || [ "$S" = failed ] && break
    sleep 1
  done
  curl -fsS -o /dev/null -X POST "$BASE/imports/$ID/commit" -H "Authorization: Bearer $TOKEN" || true
  for _ in $(seq 1 60); do
    S=$(curl -fsS "$BASE/imports/$ID" -H "Authorization: Bearer $TOKEN" | json "d['status'] + ' | ' + str(d['message'])")
    case "$S" in done*|failed*) break ;; esac
    sleep 1
  done
  echo "$kind: $S"
done

# ---------------------------------------------------------------- test accounts
# faculty@openqz.dev / Faculty@2026 teaches CSE Sem 5 A (BCS501); student@openqz.dev /
# Student@2026 is in CSE Sem 5 A. Used by the e2e accessibility checks. Idempotent.
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
make_tester() { # role username name email password
  local resp tmp t
  resp=$(curl -sS -X POST "$BASE/users" "${AUTH[@]}" \
    -d "{\"username\":\"$2\",\"full_name\":\"$3\",\"email\":\"$4\",\"role\":\"$1\"}")
  tmp=$(echo "$resp" | json "d.get('temporary_password', '')")
  [ -z "$tmp" ] && { echo "$4 already exists"; return; }
  t=$(curl -fsS -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$4\",\"password\":\"$tmp\"}" | json "d['access_token']")
  curl -fsS -o /dev/null -X POST "$BASE/auth/change-password" -H "Authorization: Bearer $t" \
    -H 'Content-Type: application/json' -d "{\"current_password\":\"$tmp\",\"new_password\":\"$5\"}"
  echo "created $4"
}
make_tester faculty EMPTEST01 "Test Faculty" faculty@openqz.dev 'Faculty@2026'
make_tester student 1DB23CS999 "Test Student" student@openqz.dev 'Student@2026'

uid() { curl -fsS "$BASE/users?q=$1" "${AUTH[@]}" | json "d['items'][0]['id']"; }
SEC=$(curl -fsS "$BASE/sections?academic_year=2026-27" "${AUTH[@]}" \
  | json "[x['id'] for x in d if x['department_code']=='CSE' and x['semester']==5 and x['name']=='A'][0]")
SUB=$(curl -fsS "$BASE/subjects" "${AUTH[@]}" | json "[x['id'] for x in d if x['code']=='BCS501'][0]")
curl -sS -o /dev/null -X POST "$BASE/sections/$SEC/students" "${AUTH[@]}" -d "{\"student_ids\":[\"$(uid 1DB23CS999)\"]}"
curl -sS -o /dev/null -X POST "$BASE/assignments" "${AUTH[@]}" \
  -d "{\"faculty_id\":\"$(uid EMPTEST01)\",\"section_id\":$SEC,\"subject_id\":$SUB}" || true
echo "test accounts mapped to CSE Sem 5 A"
