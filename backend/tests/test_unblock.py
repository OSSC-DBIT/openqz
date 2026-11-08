"""Teachers can let a student back in after a violations auto-submit."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.models import Attempt, AuditLog, Role
from tests.conftest import login, make_user
from tests.test_activities import A, assign, by_stem, make_quiz, setup_class

V = {"kind": "visibility_hidden", "session_id": "sess-12345678"}


async def block(client: AsyncClient, h: dict[str, str], att_id: str, times: int) -> None:
    for _ in range(times):
        await client.post(f"{A}/attempts/{att_id}/violations", headers=h, json=V)


async def test_unblock_reopens_attempt_and_gives_time_back(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"], time_limit_seconds=600)
    asg = await assign(
        client, c["fac"], act["id"], section_ids=[c["sec"]], max_violations=2, instant_feedback=True
    )
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    aid = st["attempt_id"]

    # Q1 answered with instant feedback (locked for good), Q2 only autosaved
    q0 = (await client.get(f"{A}/attempts/{aid}/questions/0", headers=c["s1"])).json()
    q0_id = q0["question"]["id"]
    first = next(o["id"] for o in q0["question"]["options"])
    await client.put(
        f"{A}/attempts/{aid}/answers/{q0_id}",
        headers=c["s1"],
        json={"response": {"choice": first}, "final": True},
    )
    q1 = (await client.get(f"{A}/attempts/{aid}/questions/1", headers=c["s1"])).json()
    q1_id = q1["question"]["id"]
    opt = next(o["id"] for o in q1["question"]["options"])
    await client.put(
        f"{A}/attempts/{aid}/answers/{q1_id}", headers=c["s1"], json={"response": {"choice": opt}}
    )
    await block(client, c["s1"], aid, 2)

    # the student is out, and the report shows them as blocked
    st2 = (await client.get(f"{A}/attempts/{aid}", headers=c["s1"])).json()
    assert st2["status"] == "submitted" and st2["submit_reason"] == "violations"
    rep = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/results", headers=c["fac"])
    ).json()
    row = next(s for s in rep["students"] if s["usn"] == "1DB23CS001")
    assert row["blocked_attempt_id"] == aid and row["unblocked"] == 0

    # 10 minutes pass while they are blocked
    async with SessionLocal() as s:
        att = await s.get(Attempt, aid)
        assert att is not None
        old_deadline = att.deadline_at
        await s.execute(
            update(Attempt)
            .where(Attempt.id == att.id)
            .values(submitted_at=datetime.now(UTC) - timedelta(minutes=10))
        )
        await s.commit()

    r = await client.post(
        f"{A}/activity-assignments/attempts/{aid}/unblock",
        headers=c["fac"],
        json={"extra_minutes": 5},
    )
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["status"] == "in_progress" and view["violations"] == 0
    assert view["unblocked_count"] == 1 and view["can_unblock"] is False

    async with SessionLocal() as s:
        att = await s.get(Attempt, aid)
        assert att is not None and old_deadline is not None and att.deadline_at is not None
        gained = att.deadline_at - old_deadline
        assert timedelta(minutes=14, seconds=50) < gained < timedelta(minutes=15, seconds=10)
        log = await s.scalar(select(AuditLog).where(AuditLog.action == "attempt.unblock"))
        assert log is not None and log.meta and log.meta["violations"] == 2

    # back in: Q2 can change, the instant-feedback answer stays locked
    again = (await client.get(f"{A}/attempts/{aid}/questions/1", headers=c["s1"])).json()
    assert again["locked"] is False and again["response"] == {"choice": opt}
    ok = await client.put(
        f"{A}/attempts/{aid}/answers/{q1_id}",
        headers=c["s1"],
        json={"response": {"choice": "false"}},
    )
    assert ok.status_code == 200
    locked = await client.put(
        f"{A}/attempts/{aid}/answers/{q0_id}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}},
    )
    assert locked.status_code == 409

    # warnings start from zero again
    r1 = (await client.post(f"{A}/attempts/{aid}/violations", headers=c["s1"], json=V)).json()
    assert r1 == {"violations": 1, "max": 2, "submitted": False}

    # and the student can finish normally
    done = await client.post(f"{A}/attempts/{aid}/submit", headers=c["s1"])
    assert done.status_code == 200 and done.json()["submit_reason"] == "manual"
    rep = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/results", headers=c["fac"])
    ).json()
    row = next(s for s in rep["students"] if s["usn"] == "1DB23CS001")
    assert row["blocked_attempt_id"] is None and row["unblocked"] == 1
    # overview grid: one cell per question; Q2 was changed to "false" (correct), Q1 locked wrong
    assert len(row["cells"]) == 6
    assert set(row["cells"].values()) <= {"correct", "partial", "wrong", "pending", "blank"}
    assert "blank" in row["cells"].values()


async def test_unblock_rules(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], max_violations=1)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    aid = st["attempt_id"]
    url = f"{A}/activity-assignments/attempts/{aid}/unblock"

    # not blocked yet
    r = await client.post(url, headers=c["fac"], json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_blocked"

    await block(client, c["s1"], aid, 1)
    # students cannot unblock themselves; other teachers cannot either
    assert (await client.post(url, headers=c["s1"], json={})).status_code == 403
    await make_user("EMP2", Role.faculty)
    other = await login(client, "EMP2")
    assert (await client.post(url, headers=other, json={})).status_code == 404
    # extra time is capped
    assert (
        await client.post(url, headers=c["fac"], json={"extra_minutes": 500})
    ).status_code == 422

    # no retakes: the student cannot start a fresh attempt, only the teacher can reopen this one
    again = await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    assert again.status_code == 403 and again.json()["detail"]["code"] == "already_taken"

    # a manual submit can never be reopened
    st2 = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s2"])).json()
    await client.post(f"{A}/attempts/{st2['attempt_id']}/submit", headers=c["s2"])
    r = await client.post(
        f"{A}/activity-assignments/attempts/{st2['attempt_id']}/unblock", headers=c["fac"], json={}
    )
    assert r.status_code == 409
