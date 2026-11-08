from decimal import Decimal

import pytest

from app.services.grading import grade, key_for_review, strip_key


def q(qtype: str, **kw):  # type: ignore[no-untyped-def]
    base = {
        "id": "q1",
        "type": qtype,
        "marks": 2,
        "options": [],
        "answer": {},
        "partial_credit": True,
    }
    base.update(kw)
    return base


OPTS = [{"id": "a", "correct": True}, {"id": "b"}, {"id": "c", "correct": True}, {"id": "d"}]


def test_mcq() -> None:
    m = q("mcq", options=[{"id": "a"}, {"id": "b", "correct": True}])
    assert grade(m, {"choice": "b"}).score == Decimal("2")
    r = grade(m, {"choice": "a"})
    assert r.score == 0 and r.correct is False
    assert grade(m, None).score == 0


def test_true_false() -> None:
    t = q("true_false", options=[{"id": "true", "correct": True}, {"id": "false"}])
    assert grade(t, {"choice": "true"}).correct is True
    assert grade(t, {"choice": "false"}).correct is False


@pytest.mark.parametrize(
    ("choices", "expected"),
    [
        (["a", "c"], Decimal("2")),  # all right
        (["a"], Decimal("1.00")),  # half
        (["a", "b"], Decimal("0.00")),  # one right one wrong cancels
        (["a", "c", "b"], Decimal("1.00")),  # extra wrong costs
        (["b", "d"], Decimal("0.00")),  # never negative
        ([], Decimal("0.00")),
    ],
)
def test_multi_select_partial(choices: list[str], expected: Decimal) -> None:
    assert grade(q("multi_select", options=OPTS), {"choices": choices}).score == expected


def test_multi_select_all_or_nothing() -> None:
    m = q("multi_select", options=OPTS, partial_credit=False)
    assert grade(m, {"choices": ["a"]}).score == 0
    assert grade(m, {"choices": ["c", "a"]}).score == 2


def test_fill_blank_alternatives_case_and_spaces() -> None:
    f = q("fill_blank", answer={"blanks": [["Paris", "paris city"], ["1789"]]})
    assert grade(f, {"blanks": ["  PARIS ", "1789"]}).score == 2
    assert grade(f, {"blanks": ["Paris  City.", "1789"]}).correct is True
    assert grade(f, {"blanks": ["paris", "1790"]}).score == Decimal("1.00")
    assert grade(f, {"blanks": ["paris"]}).score == Decimal("1.00")  # missing blank


def test_fill_blank_case_sensitive() -> None:
    f = q("fill_blank", answer={"blanks": [["NaCl"]], "case_sensitive": True})
    assert grade(f, {"blanks": ["nacl"]}).score == 0
    assert grade(f, {"blanks": ["NaCl"]}).score == 2


def test_open_ended_needs_manual_unless_empty() -> None:
    o = q("open_ended")
    r = grade(o, {"text": "An essay"})
    assert r.needs_manual and r.score is None
    assert grade(o, {"text": "   "}).score == 0
    assert grade(o, None).needs_manual is False


def test_justify_choice_checked_text_manual() -> None:
    j = q("justify", options=[{"id": "a", "correct": True}, {"id": "b"}])
    r = grade(j, {"choice": "a", "text": "because"})
    assert r.correct is True and r.needs_manual and r.score is None
    assert grade(j, {"choice": "b"}).score == 0  # no justification written


def test_poll_never_scores() -> None:
    assert grade(q("mcq", options=OPTS), {"choice": "a"}, graded=False).score is None


def test_strip_key_hides_answers() -> None:
    m = q("multi_select", options=OPTS, explanation="secret")
    s = strip_key(m)
    assert all("correct" not in o for o in s["options"])
    assert "explanation" not in s and "answer" not in s
    assert s["select_count"] == 2
    f = strip_key(q("fill_blank", answer={"blanks": [["x"], ["y"]]}))
    assert f["blank_count"] == 2 and "answer" not in f


def test_key_for_review() -> None:
    assert key_for_review(q("multi_select", options=OPTS)) == {"choices": ["a", "c"]}
    assert key_for_review(q("fill_blank", answer={"blanks": [["Paris", "p"]]})) == {
        "blanks": ["Paris"]
    }
