"""Importing questions: a public Google Form, a spreadsheet, pasted text, and the bulk add."""

import io
import json
from typing import Any

import pytest
from httpx import AsyncClient

from app.models import Role
from app.services import question_import as qi
from tests.conftest import login, make_user
from tests.test_activities import make_quiz, setup_class

A = "/api/v1"

FORM_DATA = [
    None,
    [
        "About this form",
        [
            [1, "Capital of India?", None, 2, [[11, [["Mumbai"], ["New Delhi"], ["Chennai"]], 1]]],
            [2, "Pick the even numbers", "More than one", 4, [[12, [["2"], ["3"], ["4"]], 0]]],
            [3, "Your branch", None, 3, [[13, [["CSE"], ["ECE"]], 0]]],
            [4, "Rate the lab", None, 5, [[14, [["1"], ["2"], ["3"]], 0]]],
            [5, "Why engineering?", None, 1, [[15, None, 0]]],
            [6, "Timetable", None, 7, []],
            [7, "Part two", None, 8],
            [8, "Lonely", None, 2, [[16, [["Only one"]], 0]]],
        ],
        None,
        None,
        None,
        None,
        None,
        None,
        "Unit 2 revision",
    ],
    "/forms",
    "Untitled form",
]


def form_html(data: Any = FORM_DATA) -> str:
    return (
        f"<html><body><script>var FB_PUBLIC_LOAD_DATA_ = {json.dumps(data)};</script></body></html>"
    )


# ---------------------------------------------------------------- parsers


def test_google_form_questions_come_without_a_key() -> None:
    p = qi.parse_google_form(form_html())
    assert p.title == "Unit 2 revision"
    assert [(q["type"], q["needs_key"]) for q in p.questions] == [
        ("mcq", True),
        ("multi_select", True),
        ("mcq", True),  # dropdown
        ("mcq", True),  # scale
        ("open_ended", False),
    ]
    assert [o["text"] for o in p.questions[0]["options"]] == ["Mumbai", "New Delhi", "Chennai"]
    assert not any(o["correct"] for q in p.questions for o in q["options"])
    assert p.questions[1]["stem"] == "Pick the even numbers\n\nMore than one"
    # a section break is not listed; a grid and a one-option question are, with the reason
    assert [s["title"] for s in p.skipped] == ["Timetable", "Lonely"]


def test_google_form_page_without_data_is_a_clear_error() -> None:
    with pytest.raises(qi.ImportProblem, match="sign-in"):
        qi.parse_google_form("<html>Sign in to continue</html>")


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://docs.google.com/forms/d/e/abc/viewform?usp=sf_link", True),
        ("https://docs.google.com/forms/d/abc/edit", True),
        ("https://forms.gle/AbCd123", True),
        ("http://docs.google.com/forms/d/abc/viewform", False),  # not https
        ("https://docs.google.com/document/d/abc", False),  # Google, but not a form
        ("https://docs.google.com.evil.example/forms/d/abc", False),
        ("https://evil.example/forms/d/abc", False),
        ("https://user@docs.google.com/forms/d/abc", False),
        ("https://docs.google.com:8443/forms/d/abc", False),
        ("http://169.254.169.254/latest/meta-data", False),
        ("file:///etc/passwd", False),
    ],
)
def test_only_google_forms_addresses_are_fetched(url: str, ok: bool) -> None:
    if ok:
        checked = qi.check_form_url(url)
        assert checked.startswith(("https://docs.google.com/forms/", "https://forms.gle/"))
        assert "/edit" not in checked
    else:
        with pytest.raises(qi.ImportProblem):
            qi.check_form_url(url)


def test_sheet_csv_types_keys_marks_and_timers() -> None:
    data = (
        b"Question,Type,Option A,Option B,Option C,Correct,Marks,Time,Explanation\n"
        b"Capital of France?,,London,Paris,Rome,B,2,30,Since 987\n"
        b'Primes?,multi,2,4,3,"A, C",1,,\n'
        b"Sky is blue,tf,,,,TRUE,,,\n"
        b"Water is ___,fill,,,,H2O | water,,,\n"
        b"Explain gravity,,,,,,5,,\n"
        b"No key here,mcq,One,Two,,,,,\n"
        b"Odd one,riddle,,,,,,,\n"
        b"Too few,mcq,Only,,,A,,,\n"
    )
    p = qi.parse_sheet(data, "questions.csv")
    q = p.questions
    assert [x["type"] for x in q] == [
        "mcq",
        "multi_select",
        "true_false",
        "fill_blank",
        "open_ended",
        "mcq",
    ]
    assert [o["correct"] for o in q[0]["options"]] == [False, True, False]
    assert (q[0]["marks"], q[0]["time_limit_seconds"], q[0]["explanation"]) == (
        "2",
        30,
        "Since 987",
    )
    assert [o["correct"] for o in q[1]["options"]] == [True, False, True]
    assert q[2]["answer"] == {"value": True}
    assert q[3]["answer"]["blanks"] == [["H2O", "water"]]
    assert q[4]["marks"] == "5" and not q[4]["needs_key"]
    assert q[5]["needs_key"]  # the teacher marks it during review
    assert {s["title"] for s in p.skipped} == {"Odd one", "Too few"}


def test_sheet_xlsx_and_missing_question_column() -> None:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(["Question", "Option 1", "Option 2", "Answer"])
    ws.append(["2 + 2?", 3, 4, "4"])  # the answer given as the option's text
    buf = io.BytesIO()
    wb.save(buf)
    p = qi.parse_sheet(buf.getvalue(), "q.xlsx")
    assert [o["correct"] for o in p.questions[0]["options"]] == [False, True]

    with pytest.raises(qi.ImportProblem, match="Question"):
        qi.parse_sheet(b"Stem here,A,B\nx,1,2\n", "q.csv")
    with pytest.raises(qi.ImportProblem, match="csv or .xlsx"):
        qi.parse_sheet(b"x", "q.pdf")


def test_pasted_text_blocks() -> None:
    p = qi.parse_text(
        "1. Capital of France?\nA) London\n*B) Paris\nC) Rome\n\n"
        "Q2) Pick primes\na. 2\nb. 4\nc. 3\nAnswer: a, c\n\n"
        "The sky is blue\nAnswer: true\n\n"
        "Water is ___ and ___\nAnswer: H2O | water; wet\n\n"
        "No key\n- one\n- two\n\n"
        "Explain gravity."
    )
    q = p.questions
    assert [x["type"] for x in q] == [
        "mcq",
        "multi_select",
        "true_false",
        "fill_blank",
        "mcq",
        "open_ended",
    ]
    assert q[0]["stem"] == "Capital of France?" and q[1]["stem"] == "Pick primes"
    assert [o["correct"] for o in q[0]["options"]] == [False, True, False]
    assert [o["correct"] for o in q[1]["options"]] == [True, False, True]
    assert q[3]["answer"]["blanks"] == [["H2O", "water"], ["wet"]]
    assert q[4]["needs_key"] and not q[0]["needs_key"]


# ---------------------------------------------------------------- endpoints


async def test_form_preview_then_bulk_add(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = await setup_class(client)
    asked: list[str] = []

    def fake_fetch(url: str) -> str:
        asked.append(url)
        return form_html()

    monkeypatch.setattr(qi, "fetch_form_html", fake_fetch)

    bad = await client.post(
        f"{A}/question-import/google-form",
        headers=c["fac"],
        json={"url": "https://evil.example/forms/d/abc/viewform"},
    )
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "import_failed"
    assert asked == []  # a non-Google address is never fetched

    r = await client.post(
        f"{A}/question-import/google-form",
        headers=c["fac"],
        json={"url": "https://docs.google.com/forms/d/e/abc/viewform"},
    )
    assert r.status_code == 200, r.text
    found = r.json()["questions"]
    assert len(found) == 5 and asked == ["https://docs.google.com/forms/d/e/abc/viewform"]

    act = (
        await client.post(f"{A}/activities", headers=c["fac"], json={"title": "From a form"})
    ).json()
    url = f"{A}/activities/{act['id']}/questions/bulk"

    # as it came (no key): refused, and nothing is stored
    raw = [{k: v for k, v in q.items() if k != "needs_key"} for q in found]
    no_key = await client.post(url, headers=c["fac"], json={"questions": raw})
    assert no_key.status_code == 400
    assert no_key.json()["detail"]["message"].startswith("Question 1:")
    assert (await client.get(f"{A}/activities/{act['id']}", headers=c["fac"])).json()[
        "questions"
    ] == []

    # the teacher marks the right answers during review
    raw[0]["options"][1]["correct"] = True
    raw[1]["options"][0]["correct"] = raw[1]["options"][2]["correct"] = True
    raw[2]["options"][0]["correct"] = True
    raw[3]["options"][2]["correct"] = True
    ok = await client.post(url, headers=c["fac"], json={"questions": raw})
    assert ok.status_code == 201, ok.text
    saved = ok.json()["questions"]
    assert [q["position"] for q in saved] == [0, 1, 2, 3, 4]
    assert [q["type"] for q in saved] == ["mcq", "multi_select", "mcq", "mcq", "open_ended"]
    assert saved[0]["options"][1]["correct"] is True

    # appended after what is there, never replacing it
    more = await client.post(url, headers=c["fac"], json={"questions": raw[:1]})
    assert [q["position"] for q in more.json()["questions"]] == [0, 1, 2, 3, 4, 5]


async def test_file_and_text_preview_roles_and_limits(client: AsyncClient) -> None:
    c = await setup_class(client)
    files = {"file": ("q.csv", b"Question,Option A,Option B,Correct\nOne?,x,y,A\n", "text/csv")}
    r = await client.post(f"{A}/question-import/file", headers=c["fac"], files=files)
    assert r.status_code == 200, r.text
    assert r.json()["questions"][0]["options"][0]["correct"] is True

    big = {"file": ("q.csv", b"Question\n" + b"x" * (2 * 1024 * 1024 + 10), "text/csv")}
    assert (
        await client.post(f"{A}/question-import/file", headers=c["fac"], files=big)
    ).status_code == 413

    t = await client.post(
        f"{A}/question-import/text", headers=c["fac"], json={"text": "Is it?\nAnswer: false"}
    )
    assert t.status_code == 200 and t.json()["questions"][0]["answer"] == {"value": False}
    empty = await client.post(f"{A}/question-import/text", headers=c["fac"], json={"text": "   "})
    assert empty.status_code == 400

    # students cannot import; a club organiser can
    assert (
        await client.post(f"{A}/question-import/text", headers=c["s1"], json={"text": "x"})
    ).status_code == 403
    await make_user("CLUB7", Role.club, full_name="Club")
    ch = await login(client, "CLUB7")
    assert (
        await client.post(f"{A}/question-import/text", headers=ch, json={"text": "Open one"})
    ).status_code == 200


async def test_bulk_add_respects_ownership_and_locked_questions(client: AsyncClient) -> None:
    c = await setup_class(client)
    act = await make_quiz(client, c["fac"])
    one = {"type": "open_ended", "stem": "Extra", "marks": 1}
    url = f"{A}/activities/{act['id']}/questions/bulk"

    await make_user("EMP2", Role.faculty, full_name="Other teacher")
    other = await login(client, "EMP2")
    assert (await client.post(url, headers=other, json={"questions": [one]})).status_code == 404

    asg = (
        await client.post(
            f"{A}/activities/{act['id']}/assign", headers=c["fac"], json={"section_ids": [c["sec"]]}
        )
    ).json()
    await client.post(f"{A}/me/assignments/{asg['id']}/start", headers=c["s1"])
    locked = await client.post(url, headers=c["fac"], json={"questions": [one]})
    assert locked.status_code == 409 and locked.json()["detail"]["code"] == "has_attempts"
