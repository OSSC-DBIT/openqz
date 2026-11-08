from datetime import UTC, datetime

from httpx import AsyncClient

from tests.conftest import login, make_user


async def test_events_ingest_and_list(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    await make_user("1DB23CS077", full_name="Student")
    sh = await login(client, "1DB23CS077")
    now = datetime.now(UTC).isoformat()

    ev = await client.post(
        "/api/v1/integrity/events",
        headers=sh,
        json={
            "session_id": "sess-abcdef12",
            "events": [
                {"kind": "visibility_hidden", "at": now},
                {"kind": "back_navigation", "at": now, "meta": {"count": 1}},
            ],
        },
    )
    assert ev.status_code == 204

    bad = await client.post(
        "/api/v1/integrity/events",
        headers=sh,
        json={"session_id": "sess-abcdef12", "events": [{"kind": "Bad Kind!", "at": now}]},
    )
    assert bad.status_code == 422

    listed = await client.get("/api/v1/integrity/events", headers=admin_headers)
    assert {e["kind"] for e in listed.json()} == {"visibility_hidden", "back_navigation"}

    # students cannot read the log
    assert (await client.get("/api/v1/integrity/events", headers=sh)).status_code == 403
