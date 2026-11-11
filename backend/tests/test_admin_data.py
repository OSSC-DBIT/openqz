"""Admin deletes for good: a person, an activity, one assignment's results. Each needs the
name typed out and the admin's own password again."""

from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import Activity, ActivityAssignment, Attempt, AuditLog, Role, User
from tests.conftest import PASSWORD, email_for, login, make_user
from tests.test_activities import A, assign, make_quiz, setup_class

D = f"{A}/admin/data"


async def _world(client: AsyncClient) -> dict[str, Any]:
    """A class with one assignment that student 1 has started, and an admin."""
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    asg = await assign(client, c["fac"], act["id"], section_ids=[c["sec"]])
    st = (await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])).json()
    await make_user("admin", Role.admin, full_name="Admin")
    return {
        **c,
        "act": act,
        "asg": asg,
        "attempt": st["attempt_id"],
        "admin": await login(client, "admin"),
    }


async def _n(model: Any) -> int:
    async with SessionLocal() as s:
        return (await s.scalar(select(func.count()).select_from(model))) or 0


async def _audit(action: str) -> list[AuditLog]:
    async with SessionLocal() as s:
        return list((await s.scalars(select(AuditLog).where(AuditLog.action == action))).all())


def ok(confirm: str) -> dict[str, str]:
    return {"confirm": confirm, "password": PASSWORD}


async def test_impact_shows_what_goes_with_a_person(client: AsyncClient) -> None:
    w = await _world(client)
    fac = (await client.get(f"{D}/users/{w['fac_id']}/impact", headers=w["admin"])).json()
    assert (fac["activities"], fac["assignments"], fac["attempts_by_students"]) == (1, 1, 1)
    assert fac["blocked_by"] is None and fac["username"] == "EMP1"
    stu = (await client.get(f"{D}/users/{w['s1_id']}/impact", headers=w["admin"])).json()
    assert (stu["attempts"], stu["activities"]) == (1, 0)
    # only admins may even look
    assert (await client.get(f"{D}/users/{w['s1_id']}/impact", headers=w["fac"])).status_code == 403


async def test_deleting_a_student_needs_the_name_and_the_admin_password(
    client: AsyncClient,
) -> None:
    w = await _world(client)
    url = f"{D}/users/{w['s1_id']}/delete"

    # not an admin
    assert (await client.post(url, headers=w["fac"], json=ok("1DB23CS001"))).status_code == 403
    # the name typed wrong: nothing happens, the password is not even checked
    r = await client.post(url, headers=w["admin"], json=ok("1DB23CS002"))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "confirm_mismatch"
    # a wrong password
    r = await client.post(
        url, headers=w["admin"], json={"confirm": "1DB23CS001", "password": "not-mine"}
    )
    assert r.status_code == 403 and r.json()["detail"]["code"] == "wrong_password"
    assert len(await _audit("admin_delete_denied")) == 1
    assert await _n(Attempt) == 1  # still there

    # right name (any letter case) and right password
    r = await client.post(url, headers=w["admin"], json=ok("1db23cs001"))
    assert r.status_code == 204, r.text
    assert await _n(Attempt) == 0
    async with SessionLocal() as s:
        assert await s.get(User, w["s1_id"]) is None
    # their session is dead and they cannot sign in again
    assert (await client.get(f"{A}/me/activities", headers=w["s1"])).status_code == 401
    again = await client.post(
        f"{A}/auth/login", json={"email": email_for("1DB23CS001"), "password": PASSWORD}
    )
    assert again.status_code == 401
    # the other student and the teacher's activity are untouched
    assert await _n(Activity) == 1 and await _n(ActivityAssignment) == 1
    (log,) = await _audit("user_deleted")
    assert log.target == "1DB23CS001" and log.meta is not None and log.meta["attempts"] == 1


async def test_deleting_a_teacher_takes_their_activities_and_the_student_work(
    client: AsyncClient,
) -> None:
    w = await _world(client)
    r = await client.post(f"{D}/users/{w['fac_id']}/delete", headers=w["admin"], json=ok("EMP1"))
    assert r.status_code == 204, r.text
    assert (await _n(Activity), await _n(ActivityAssignment), await _n(Attempt)) == (0, 0, 0)
    # the students themselves stay
    async with SessionLocal() as s:
        assert await s.get(User, w["s1_id"]) is not None
    (log,) = await _audit("user_deleted")
    assert log.meta is not None and log.meta["attempts_by_students"] == 1


async def test_an_admin_cannot_delete_themselves_and_wrong_passwords_lock_deleting(
    client: AsyncClient,
) -> None:
    w = await _world(client)
    async with SessionLocal() as s:
        me = await s.scalar(select(User).where(User.username == "admin"))
        assert me is not None
    mine = await client.post(f"{D}/users/{me.id}/delete", headers=w["admin"], json=ok("admin"))
    assert mine.status_code == 400 and "your own account" in mine.text
    impact = (await client.get(f"{D}/users/{me.id}/impact", headers=w["admin"])).json()
    assert impact["blocked_by"]

    url = f"{D}/users/{w['s1_id']}/delete"
    bad = {"confirm": "1DB23CS001", "password": "guess"}
    codes = [(await client.post(url, headers=w["admin"], json=bad)).status_code for _ in range(6)]
    assert codes == [403] * 5 + [429]
    # locked now, even with the right password
    locked = await client.post(url, headers=w["admin"], json=ok("1DB23CS001"))
    assert locked.status_code == 429 and locked.json()["detail"]["code"] == "too_many_tries"
    async with SessionLocal() as s:
        assert await s.get(User, w["s1_id"]) is not None


async def test_delete_an_activity_for_good(client: AsyncClient) -> None:
    w = await _world(client)
    url = f"{D}/activities/{w['act']['id']}/delete"
    # the owner's normal Delete only archives it, because a student has started
    await client.delete(f"{A}/activities/{w['act']['id']}", headers=w["fac"])
    assert await _n(Activity) == 1 and await _n(Attempt) == 1
    # the owner cannot use the admin delete
    assert (await client.post(url, headers=w["fac"], json=ok("Unit 1"))).status_code == 403
    assert (await client.post(url, headers=w["admin"], json=ok("Unit 2"))).status_code == 400

    r = await client.post(url, headers=w["admin"], json=ok("Unit 1"))
    assert r.status_code == 204, r.text
    assert (await _n(Activity), await _n(ActivityAssignment), await _n(Attempt)) == (0, 0, 0)
    (log,) = await _audit("activity_deleted_forever")
    assert log.meta is not None and (log.meta["assignments"], log.meta["attempts"]) == (1, 1)
    assert (await client.post(url, headers=w["admin"], json=ok("Unit 1"))).status_code == 404


async def test_delete_the_results_of_one_assignment(client: AsyncClient) -> None:
    w = await _world(client)
    other = await assign(client, w["fac"], w["act"]["id"], room=True)
    url = f"{D}/assignments/{w['asg']['id']}/delete"
    assert (await client.post(url, headers=w["s1"], json=ok("Unit 1"))).status_code == 403
    r = await client.post(url, headers=w["admin"], json=ok("Unit 1"))
    assert r.status_code == 204, r.text
    # the attempts went with it; the activity and its other assignment stay
    assert (await _n(Activity), await _n(Attempt)) == (1, 0)
    async with SessionLocal() as s:
        left = list((await s.scalars(select(ActivityAssignment.id))).all())
    assert [str(x) for x in left] == [other["id"]]
    (log,) = await _audit("assignment_deleted_forever")
    assert log.meta is not None and log.meta["attempts"] == 1
