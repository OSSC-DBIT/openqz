"""End-to-end API flow: faculty builds and assigns, student attempts, faculty grades and reports."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update

from app.core.db import SessionLocal
from app.models import Attempt, AttemptAnswer, Role, Section, StudentSection
from tests.conftest import login, make_user

A = "/api/v1"


async def setup_class(client: AsyncClient) -> dict[str, Any]:
    fac = await make_user("EMP1", Role.faculty, full_name="Dr Rao")
    s1 = await make_user("1DB23CS001", full_name="Asha")
    s2 = await make_user("1DB23CS002", full_name="Bharath")
    outsider = await make_user("1DB23CS099", full_name="Other")
    async with SessionLocal() as s:
        from app.models import Department

        d = Department(code="CSE", name="CSE")
        s.add(d)
        await s.flush()
        sec = Section(department_id=d.id, semester=5, name="A", academic_year="2026-27")
        s.add(sec)
        await s.flush()
        s.add_all(
            [
                StudentSection(student_id=s1.id, section_id=sec.id),
                StudentSection(student_id=s2.id, section_id=sec.id),
            ]
        )
        # the teacher teaches this section (assigning to untaught sections is refused)
        from app.models import FacultyAssignment, Subject

        sub = Subject(code="BCS501", name="SE")
        s.add(sub)
        await s.flush()
        s.add(FacultyAssignment(faculty_id=fac.id, section_id=sec.id, subject_id=sub.id))
        await s.commit()
        sec_id = sec.id
    return {
        "fac": await login(client, "EMP1"),
        "s1": await login(client, "1DB23CS001"),
        "s2": await login(client, "1DB23CS002"),
        "out": await login(client, "1DB23CS099"),
        "sec": sec_id,
        "s1_id": s1.id,
        "fac_id": fac.id,
        "outsider_id": outsider.id,
    }


QUESTIONS = [
    {
        "type": "mcq",
        "stem": "2+2?",
        "marks": 1,
        "options": [{"text": "3"}, {"text": "4", "correct": True}, {"text": "5"}],
        "explanation": "Basic addition",
    },
    {"type": "true_false", "stem": "The sky is green", "answer": {"value": False}, "marks": 1},
    {
        "type": "multi_select",
        "stem": "Primes?",
        "marks": 2,
        "options": [{"text": "2", "correct": True}, {"text": "3", "correct": True}, {"text": "4"}],
    },
    {
        "type": "fill_blank",
        "stem": "Capital of France is ___",
        "marks": 1,
        "answer": {"blanks": [["Paris"]]},
    },
    {
        "type": "justify",
        "stem": "Best sort for nearly sorted data?",
        "marks": 2,
        "options": [{"text": "Insertion", "correct": True}, {"text": "Selection"}],
    },
    {"type": "open_ended", "stem": "Explain recursion", "marks": 3},
]


async def make_quiz(client: AsyncClient, h: dict[str, str], **extra: Any) -> dict[str, Any]:
    r = await client.post(
        f"{A}/activities", headers=h, json={"title": "Unit 1", "kind": "quiz", **extra}
    )
    assert r.status_code == 201, r.text
    act = r.json()
    for q in QUESTIONS:
        rq = await client.post(f"{A}/activities/{act['id']}/questions", headers=h, json=q)
        assert rq.status_code == 201, rq.text
    return (await client.get(f"{A}/activities/{act['id']}", headers=h)).json()


async def assign(
    client: AsyncClient, h: dict[str, str], act_id: str, **settings: Any
) -> dict[str, Any]:
    r = await client.post(f"{A}/activities/{act_id}/assign", headers=h, json=settings)
    assert r.status_code == 201, r.text
    return r.json()


def by_stem(state_q: dict[str, Any], text: str) -> str:
    return next(o["id"] for o in state_q["question"]["options"] if o["text"] == text)


async def answer_all_correctly(
    client: AsyncClient, h: dict[str, str], att_id: str, total: int
) -> None:
    for i in range(total):
        q = (await client.get(f"{A}/attempts/{att_id}/questions/{i}", headers=h)).json()
        if q["locked"]:
            continue  # already answered with instant feedback
        stem = q["question"]["stem"]
        qid = q["question"]["id"]
        resp: dict[str, Any] = {
            "2+2?": {"choice": by_stem(q, "4")} if "2+2?" == stem else None,
        }.get(stem)
        if stem == "The sky is green":
            resp = {"choice": "false"}
        elif stem == "Primes?":
            resp = {"choices": [by_stem(q, "2"), by_stem(q, "3")]}
        elif stem.startswith("Capital"):
            resp = {"blanks": [" paris "]}
        elif stem.startswith("Best sort"):
            resp = {"choice": by_stem(q, "Insertion"), "text": "Few swaps needed"}
        elif stem.startswith("Explain"):
            resp = {"text": "A function calling itself"}
        r = await client.put(
            f"{A}/attempts/{att_id}/answers/{qid}",
            headers=h,
            json={"response": resp, "final": True},
        )
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------- editor


async def test_editor_validation_and_tools(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    assert act["question_count"] == 6 and Decimal(act["total_marks"]) == 10
    tf = next(q for q in act["questions"] if q["type"] == "true_false")
    assert [o["id"] for o in tf["options"]] == ["true", "false"]

    bad = [
        {"type": "mcq", "stem": "x", "options": [{"text": "a"}, {"text": "b"}]},  # no correct
        {"type": "mcq", "stem": "x", "options": [{"text": "a", "correct": True}]},  # one option
        {"type": "multi_select", "stem": "x", "options": [{"text": "a"}, {"text": "b"}]},
        {"type": "true_false", "stem": "x"},
        {"type": "fill_blank", "stem": "___ and ___", "answer": {"blanks": [["a"]]}},
    ]
    for q in bad:
        r = await client.post(f"{A}/activities/{act['id']}/questions", headers=c["fac"], json=q)
        assert r.status_code in (400, 422), (q, r.text)

    ids = [q["id"] for q in act["questions"]][::-1]
    r = await client.put(
        f"{A}/activities/{act['id']}/order", headers=c["fac"], json={"question_ids": ids}
    )
    assert [q["id"] for q in r.json()["questions"]] == ids

    r = await client.post(
        f"{A}/activities/{act['id']}/apply-all",
        headers=c["fac"],
        json={"time_limit_seconds": 30, "marks": 2},
    )
    assert all(
        q["time_limit_seconds"] == 30 and Decimal(q["marks"]) == 2 for q in r.json()["questions"]
    )

    dup = await client.post(f"{A}/activities/{act['id']}/duplicate", headers=c["fac"])
    assert dup.json()["title"] == "Unit 1 (copy)" and dup.json()["question_count"] == 6

    # students and other faculty cannot see it
    assert (await client.get(f"{A}/activities/{act['id']}", headers=c["s1"])).status_code == 403
    await make_user("EMP2", Role.faculty)
    other = await login(client, "EMP2")
    assert (await client.get(f"{A}/activities/{act['id']}", headers=other)).status_code == 404


# ---------------------------------------------------------------- full loop


async def test_full_loop_grading_review_results(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(
        client,
        c["fac"],
        act["id"],
        section_ids=[c["sec"]],
        due_at=(datetime.now(UTC) + timedelta(days=1)).isoformat(),
        instant_feedback=True,
        show_answers="after_submit",
    )
    assert asg["student_count"] == 2 and "CSE Sem 5 A" in asg["target_labels"][0]

    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    assert mine["pending"][0]["assignment_id"] == asg["id"]
    assert (await client.get(f"{A}/me/activities", headers=c["out"])).json()["pending"] == []
    assert (
        await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["out"])
    ).status_code == 403

    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert st["total"] == 6 and st["status"] == "in_progress"
    # resuming returns the same attempt
    again = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert again["attempt_id"] == st["attempt_id"]

    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    assert all("correct" not in o for o in q0["question"]["options"])
    assert "explanation" not in q0["question"]

    # instant feedback on a wrong MCQ answer locks it and shows the key
    wrong = by_stem(q0, "3")
    fb = (
        await client.put(
            f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
            headers=c["s1"],
            json={"response": {"choice": wrong}, "final": True},
        )
    ).json()
    assert fb["locked"] and fb["feedback"]["correct"] is False
    assert fb["feedback"]["explanation"] == "Basic addition"
    retry = await client.put(
        f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}},
    )
    assert retry.status_code == 409

    await answer_all_correctly(client, c["s1"], st["attempt_id"], 6)  # q0 stays wrong (locked)
    rv = (await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])).json()
    # 0 (mcq wrong) + 1 + 2 + 1 = 4 auto; justify + open pending
    assert rv["scores_visible"] and Decimal(rv["score"]) == 4 and rv["needs_manual"]
    assert rv["items"][0]["key"] and rv["items"][0]["explanation"]

    # after submit nothing can change
    assert (
        await client.put(
            f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
            headers=c["s1"],
            json={"response": {"choice": wrong}},
        )
    ).status_code == 409

    # grading queue -> grade both manual answers
    queue = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/grading", headers=c["fac"])
    ).json()
    assert {x["type"] for x in queue} == {"justify", "open_ended"}
    justify = next(x for x in queue if x["type"] == "justify")
    assert justify["choice_correct"] is True
    for item, score in (
        (justify, "2"),
        (next(x for x in queue if x["type"] == "open_ended"), "2.5"),
    ):
        r = await client.put(
            f"{A}/activity-assignments/attempts/{item['attempt_id']}/answers/{item['question_id']}/grade",
            headers=c["fac"],
            json={"score": score, "feedback": "Good"},
        )
        assert r.status_code == 200, r.text
    over = await client.put(
        f"{A}/activity-assignments/attempts/{justify['attempt_id']}/answers/{justify['question_id']}/grade",
        headers=c["fac"],
        json={"score": "9"},
    )
    assert over.status_code == 400

    rv = (await client.get(f"{A}/attempts/{st['attempt_id']}/review", headers=c["s1"])).json()
    assert Decimal(rv["score"]) == Decimal("8.5") and not rv["needs_manual"]
    assert any(i.get("feedback") == "Good" for i in rv["items"])

    rep = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/results", headers=c["fac"])
    ).json()
    assert rep["summary"]["assigned"] == 2 and rep["summary"]["submitted"] == 1
    assert rep["summary"]["completion"] == 50.0 and rep["summary"]["avg_accuracy"] == 85.0
    mcq = next(q for q in rep["questions"] if q["type"] == "mcq")
    assert mcq["accuracy"] == 0.0 and mcq["answered"] == 1
    # the report carries the key for the staff who own it
    assert [o["text"] for o in mcq["options"] if o["correct"]] == ["4"]
    blank = next((q for q in rep["questions"] if q["type"] == "fill_blank"), None)
    assert blank is None or blank["answer"]["blanks"]
    statuses = {s["usn"]: s["status"] for s in rep["students"]}
    assert statuses == {"1DB23CS001": "submitted", "1DB23CS002": "not_started"}

    csv = await client.get(f"{A}/activity-assignments/{asg['id']}/results.csv", headers=c["fac"])
    assert csv.status_code == 200 and "1DB23CS001" in csv.text and "8.50" in csv.text

    # attempts limit (default 1)
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    assert mine["completed"][0]["attempts_left"] == 0
    assert (
        await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    ).status_code == 403


async def test_release_modes_and_hidden_answers(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(
        client,
        c["fac"],
        act["id"],
        student_ids=[str(c["s1_id"])],
        release_mode="manual",
        show_answers="never",
        instant_feedback=False,
    )
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])).json()
    r = (
        await client.put(
            f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
            headers=c["s1"],
            json={"response": {"choice": by_stem(q0, "4")}, "final": True},
        )
    ).json()
    assert r["feedback"] is None and not r["locked"]  # no instant feedback
    rv = (await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])).json()
    assert rv["score"] is None and not rv["scores_visible"] and not rv["answers_visible"]
    assert "key" not in rv["items"][0]
    await client.post(f"{A}/activity-assignments/{asg['id']}/release", headers=c["fac"])
    rv = (await client.get(f"{A}/attempts/{st['attempt_id']}/review", headers=c["s1"])).json()
    assert rv["scores_visible"] and Decimal(rv["score"]) == 1


# ---------------------------------------------------------------- timers and integrity


async def test_activity_timer_auto_submits(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"], time_limit_seconds=600)
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert st["deadline_at"] is not None
    async with SessionLocal() as s:
        await s.execute(
            update(Attempt).values(deadline_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await s.commit()
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert state["status"] == "submitted" and state["submit_reason"] == "timer"


async def test_sweeper_submits_abandoned_attempts(client: AsyncClient) -> None:
    from app.services.attempt_service import sweep_expired

    c = await setup_class(client)
    act = await make_quiz(client, c["fac"], time_limit_seconds=60)
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    async with SessionLocal() as s:
        await s.execute(
            update(Attempt).values(deadline_at=datetime.now(UTC) - timedelta(minutes=5))
        )
        await s.commit()
        assert await sweep_expired(s) == 1


async def test_question_timer_linear_mode(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    await client.post(
        f"{A}/activities/{act['id']}/apply-all", headers=c["fac"], json={"time_limit_seconds": 20}
    )
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], instant_feedback=False)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert st["linear"] is True
    aid = st["attempt_id"]
    q0 = (await client.get(f"{A}/attempts/{aid}/questions/0", headers=c["s1"])).json()
    assert q0["question_deadline"] is not None
    assert (
        await client.get(f"{A}/attempts/{aid}/questions/2", headers=c["s1"])
    ).status_code == 409  # skip
    await client.get(f"{A}/attempts/{aid}/questions/1", headers=c["s1"])
    assert (
        await client.get(f"{A}/attempts/{aid}/questions/0", headers=c["s1"])
    ).status_code == 409  # back
    # question 0 is locked now
    r = await client.put(
        f"{A}/attempts/{aid}/answers/{q0['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": by_stem(q0, "4")}},
    )
    assert r.status_code == 409
    # time runs out on question 1
    async with SessionLocal() as s:
        await s.execute(
            update(AttemptAnswer).values(
                question_started_at=datetime.now(UTC) - timedelta(seconds=60)
            )
        )
        await s.commit()
    q1 = (await client.get(f"{A}/attempts/{aid}/questions/1", headers=c["s1"])).json()
    assert q1["locked"] is True
    late = await client.put(
        f"{A}/attempts/{aid}/answers/{q1['question']['id']}",
        headers=c["s1"],
        json={"response": {"choice": "false"}},
    )
    assert late.status_code == 409 and late.json()["detail"]["code"] == "locked"


async def test_violations_auto_submit(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], max_violations=2)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    v = {"kind": "visibility_hidden", "session_id": "sess-12345678"}
    r1 = (
        await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s1"], json=v)
    ).json()
    assert r1 == {"violations": 1, "max": 2, "submitted": False, "submit_reason": None}
    r2 = (
        await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s1"], json=v)
    ).json()
    assert r2["submitted"] is True
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert state["submit_reason"] == "violations"
    log = (await client.get(f"{A}/integrity/events", headers=c["fac"])).json()
    assert len(log) == 2 and log[0]["attempt_id"] == st["attempt_id"]
    # another student's attempt is off limits
    assert (
        await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s2"], json=v)
    ).status_code == 404


# ---------------------------------------------------------------- windows and attempts


async def test_windows_late_and_single_attempt(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    future = await assign(
        client,
        c["fac"],
        act["id"],
        section_ids=[c["sec"]],
        start_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat(),
    )
    r = await client.post(f"{A}/me/assignments/{future['id']}/start", headers=c["s1"])
    assert r.json()["detail"]["code"] == "not_started"

    past = dict(
        start_at=(datetime.now(UTC) - timedelta(days=2)).isoformat(),
        due_at=(datetime.now(UTC) - timedelta(days=1)).isoformat(),
    )
    closed = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], **past)
    assert (await client.post(f"{A}/me/assignments/{closed['id']}/start", headers=c["s1"])).json()[
        "detail"
    ]["code"] == "closed"
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    assert any(x.get("missed") for x in mine["completed"])

    late = await assign(
        client, c["fac"], act["id"], section_ids=[c["sec"]], allow_late=True, max_attempts=5, **past
    )
    st = (await client.post(f"{A}/me/assignments/{late['id']}/start", headers=c["s1"])).json()
    await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])
    # no retakes, even if a client asks for more attempts
    again = await client.post(f"{A}/me/assignments/{late['id']}/start", headers=c["s1"])
    assert again.status_code == 403 and again.json()["detail"]["code"] == "already_taken"
    mine = (await client.get(f"{A}/me/activities", headers=c["s1"])).json()
    card = next(x for x in mine["completed"] if x["assignment_id"] == late["id"])
    assert card["can_start"] is False
    rep = (
        await client.get(f"{A}/activity-assignments/{late['id']}/results", headers=c["fac"])
    ).json()
    row = next(s for s in rep["students"] if s["usn"] == "1DB23CS001")
    assert row["attempts"] == 1 and row["late"] is True


async def test_shuffle_keeps_scoring_correct(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(
        client,
        c["fac"],
        act["id"],
        section_ids=[c["sec"]],
        shuffle_questions=True,
        shuffle_options=True,
        instant_feedback=False,
    )
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await answer_all_correctly(client, c["s1"], st["attempt_id"], 6)
    rv = (await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])).json()
    assert Decimal(rv["score"]) == 5  # all objective right; justify/open pending


# ---------------------------------------------------------------- poll, flashcards, media


async def test_poll_distribution(client: AsyncClient) -> None:
    c = await setup_class(client)
    r = await client.post(
        f"{A}/activities", headers=c["fac"], json={"title": "Feedback", "kind": "poll"}
    )
    act = r.json()
    q = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={"type": "mcq", "stem": "Pace?", "options": [{"text": "Slow"}, {"text": "OK"}]},
    )
    assert q.status_code == 201, q.text
    bad = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={"type": "fill_blank", "stem": "x ___", "answer": {"blanks": [["y"]]}},
    )
    assert bad.status_code == 400
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    for h in (c["s1"], c["s2"]):
        st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=h)).json()
        q0 = (await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=h)).json()
        await client.put(
            f"{A}/attempts/{st['attempt_id']}/answers/{q0['question']['id']}",
            headers=h,
            json={"response": {"choice": by_stem(q0, "OK")}, "final": True},
        )
        rv = (await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=h)).json()
        assert rv["score"] is None
    rep = (
        await client.get(f"{A}/activity-assignments/{asg['id']}/results", headers=c["fac"])
    ).json()
    opts = {o["text"]: o["count"] for o in rep["questions"][0]["options"]}
    assert opts == {"Slow": 0, "OK": 2} and rep["summary"]["graded"] is False


async def test_flashcards_need_back_and_show_it(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = (
        await client.post(
            f"{A}/activities", headers=c["fac"], json={"title": "Terms", "kind": "flashcards"}
        )
    ).json()
    no_back = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={"type": "open_ended", "stem": "TCP"},
    )
    assert no_back.status_code == 400
    await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={"type": "open_ended", "stem": "TCP", "explanation": "Transmission Control Protocol"},
    )
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    card = (
        await client.get(f"{A}/attempts/{st['attempt_id']}/questions/0", headers=c["s1"])
    ).json()
    assert card["question"]["back"] == "Transmission Control Protocol"


async def test_image_upload_sniffs_type(client: AsyncClient) -> None:
    c = await setup_class(client)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    r = await client.post(
        f"{A}/media", headers=c["fac"], files={"file": ("x.png", png, "image/png")}
    )
    assert r.status_code == 201
    mid = r.json()["id"]
    fake = await client.post(
        f"{A}/media", headers=c["fac"], files={"file": ("evil.png", b"<script>", "image/png")}
    )
    assert fake.status_code == 400
    assert (
        await client.post(f"{A}/media", headers=c["s1"], files={"file": ("x.png", png)})
    ).status_code == 403
    got = await client.get(f"{A}/media/{mid}", headers=c["s1"])
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert (await client.get(f"{A}/media/{mid}")).status_code == 401

    act = (await client.post(f"{A}/activities", headers=c["fac"], json={"title": "Img"})).json()
    q = await client.post(
        f"{A}/activities/{act['id']}/questions",
        headers=c["fac"],
        json={
            "type": "mcq",
            "stem": "Which?",
            "stem_image_id": mid,
            "options": [{"text": "a", "image_id": mid, "correct": True}, {"text": "b"}],
        },
    )
    assert q.status_code == 201 and q.json()["stem_image_id"] == mid


async def test_section_students_and_my_assignments(client: AsyncClient) -> None:
    c = await setup_class(client)
    async with SessionLocal() as s:
        from app.models import Department

        d = Department(code="MEC", name="Mech")
        s.add(d)
        await s.flush()
        untaught = Section(department_id=d.id, semester=1, name="Z", academic_year="2026-27")
        s.add(untaught)
        await s.commit()
        untaught_id = untaught.id
    assert (
        await client.get(f"{A}/sections/{untaught_id}/students", headers=c["fac"])
    ).status_code == 403
    rows = (await client.get(f"{A}/sections/{c['sec']}/students", headers=c["fac"])).json()
    assert [r["username"] for r in rows] == ["1DB23CS001", "1DB23CS002"]
    assert (
        await client.get(f"{A}/sections/{c['sec']}/students", headers=c["s1"])
    ).status_code == 403
    # and cannot assign to a section they do not teach
    act0 = await make_quiz(client, c["fac"])
    bad = await client.post(
        f"{A}/activities/{act0['id']}/assign", headers=c["fac"], json={"section_ids": [untaught_id]}
    )
    assert bad.status_code == 403

    act = await make_quiz(client, c["fac"])
    await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    mine = (await client.get(f"{A}/activity-assignments", headers=c["fac"])).json()
    assert len(mine) == 1 and mine[0]["activity_title"] == "Unit 1"


async def test_assigning_records_the_classes_on_the_activity(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])  # created without picking classes
    assert act["section_ids"] == [] and act["class_labels"] == []
    await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    got = (await client.get(f"{A}/activities/{act['id']}", headers=c["fac"])).json()
    assert got["section_ids"] == [c["sec"]]
    assert got["class_labels"] and got["department_id"] is not None
    # the library's class filter now finds it
    lib = (
        await client.get(f"{A}/activities", headers=c["fac"], params={"section_id": c["sec"]})
    ).json()
    items = lib["items"] if isinstance(lib, dict) else lib
    assert act["id"] in [x["id"] for x in items]
    # assigning again to the same class adds nothing twice
    await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    again = (await client.get(f"{A}/activities/{act['id']}", headers=c["fac"])).json()
    assert again["section_ids"] == [c["sec"]]


async def test_violation_after_manual_submit_is_not_a_violation_submit(client: AsyncClient) -> None:
    """Leaving full screen right after pressing Submit reaches the server after the submit: it is
    logged, not counted, and the reply says the attempt ended by a manual submit."""
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]], max_violations=1)
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    assert (
        await client.post(f"{A}/attempts/{st['attempt_id']}/submit", headers=c["s1"])
    ).status_code == 200
    v = {"kind": "fullscreen_exit", "session_id": "sess-12345678"}
    r = (
        await client.post(f"{A}/attempts/{st['attempt_id']}/violations", headers=c["s1"], json=v)
    ).json()
    assert r["submitted"] is True and r["submit_reason"] == "manual" and r["violations"] == 0
    state = (await client.get(f"{A}/attempts/{st['attempt_id']}", headers=c["s1"])).json()
    assert state["submit_reason"] == "manual"
