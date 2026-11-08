// k6 load test: N students sit the same quiz at once (the realistic peak for OpenQZ).
//
//   docker compose -p openqz-smoke exec api python -m app.loadseed --students 300 --out /data/media/load-tokens.json
//   docker cp openqz-smoke-api-1:/data/media/load-tokens.json tests/load/load-tokens.json
//   docker run --rm -i -v "$PWD/tests/load:/scripts" -e BASE=http://host.docker.internal:8090 \
//     grafana/k6:0.55.0 run /scripts/student-exam.js
//
// Target (Implementation Plan, M3 quality gate): p95 < 300 ms at 300 concurrent users.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE || 'http://host.docker.internal:8090';
const seed = JSON.parse(open('./load-tokens.json'));
const tokens = new SharedArray('tokens', () => seed.tokens);
const VUS = Number(__ENV.VUS || tokens.length);

export const options = {
  scenarios: {
    exam: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: VUS }, // everyone joins within half a minute
        { duration: '90s', target: VUS }, // sitting the quiz
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:api}': ['p(95)<300'],
  },
};

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  // Host must be one the API trusts (ALLOWED_HOSTS); the URL may be host.docker.internal.
  const h = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Host: __ENV.HOST || 'localhost' }, tags: { kind: 'api' } };

  const home = http.get(`${BASE}/api/v1/me/activities`, h);
  check(home, { 'home 200': (r) => r.status === 200 });

  const start = http.post(`${BASE}/api/v1/me/assignments/${seed.assignment_id}/start`, null, h);
  if (!check(start, { 'start 200': (r) => r.status === 200 })) return;
  const attempt = start.json('attempt_id');
  const total = start.json('total');

  for (let i = 0; i < total; i++) {
    const q = http.get(`${BASE}/api/v1/attempts/${attempt}/questions/${i}`, h);
    if (!check(q, { 'question 200': (r) => r.status === 200 })) return;
    sleep(1 + Math.random() * 2); // thinking
    const qid = q.json('question.id');
    const choice = ['a', 'b', 'c', 'd'][Math.floor(Math.random() * 4)];
    const a = http.put(`${BASE}/api/v1/attempts/${attempt}/answers/${qid}`, JSON.stringify({ response: { choice } }), h);
    check(a, { 'answer 200': (r) => r.status === 200 });
  }
  const sub = http.post(`${BASE}/api/v1/attempts/${attempt}/submit`, null, h);
  check(sub, { 'submit 200': (r) => r.status === 200 });
  sleep(2);
}
