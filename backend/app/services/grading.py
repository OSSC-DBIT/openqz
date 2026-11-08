"""Auto-grading for objective question types. Pure functions over question snapshots.

A snapshot question is a dict with keys: id, type, marks, options[{id, correct}], answer,
partial_credit. A response is the dict the student submitted:
  mcq / true_false / justify: {"choice": "<option id>"}  (true_false options are "true"/"false")
  multi_select:               {"choices": ["a", "c"]}
  fill_blank:                 {"blanks": ["paris", "1789"]}
  justify:                    {"choice": "b", "text": "because ..."}
  open_ended:                 {"text": "..."}
"""

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

MANUAL_TYPES = {"open_ended", "justify"}
TWO = Decimal("0.01")


@dataclass
class GradeResult:
    score: Decimal | None  # None = needs a human
    correct: bool | None  # None = not objectively right/wrong (partial, manual, poll)
    needs_manual: bool


def _q(x: Decimal) -> Decimal:
    return x.quantize(TWO, rounding=ROUND_HALF_UP)


def normalize_blank(text: str, case_sensitive: bool) -> str:
    t = re.sub(r"\s+", " ", str(text)).strip()
    t = t.rstrip(".")
    return t if case_sensitive else t.lower()


def correct_option_ids(q: dict[str, Any]) -> set[str]:
    return {o["id"] for o in q.get("options", []) if o.get("correct")}


def grade(
    q: dict[str, Any], response: dict[str, Any] | None, *, graded: bool = True
) -> GradeResult:
    """Grade one answer. `graded=False` (polls) never scores."""
    qtype = q["type"]
    marks = Decimal(str(q.get("marks", 1)))
    if not graded:
        return GradeResult(score=None, correct=None, needs_manual=False)

    if qtype == "open_ended":
        has_text = bool(response and str(response.get("text", "")).strip())
        # An empty open answer is simply zero; anything written needs a human.
        return GradeResult(
            score=None if has_text else Decimal("0"), correct=None, needs_manual=has_text
        )

    if not response:
        return GradeResult(score=Decimal("0"), correct=False, needs_manual=False)

    if qtype in ("mcq", "true_false", "justify"):
        ok = response.get("choice") in correct_option_ids(q)
        score = marks if ok else Decimal("0")
        if qtype == "justify":
            # Choice is auto-checked; the justification still needs a teacher.
            has_text = bool(str(response.get("text", "")).strip())
            return GradeResult(score=None if has_text else score, correct=ok, needs_manual=has_text)
        return GradeResult(score=score, correct=ok, needs_manual=False)

    if qtype == "multi_select":
        right = correct_option_ids(q)
        chosen = set(response.get("choices") or [])
        if not right:
            return GradeResult(score=Decimal("0"), correct=False, needs_manual=False)
        if chosen == right:
            return GradeResult(score=marks, correct=True, needs_manual=False)
        if not q.get("partial_credit", True):
            return GradeResult(score=Decimal("0"), correct=False, needs_manual=False)
        hits = len(chosen & right)
        misses = len(chosen - right)
        fraction = max(Decimal("0"), Decimal(hits - misses) / Decimal(len(right)))
        return GradeResult(score=_q(marks * fraction), correct=False, needs_manual=False)

    if qtype == "fill_blank":
        key = q.get("answer", {})
        blanks: list[list[str]] = key.get("blanks", [])
        cs = bool(key.get("case_sensitive", False))
        given = list(response.get("blanks") or [])
        if not blanks:
            return GradeResult(score=Decimal("0"), correct=False, needs_manual=False)
        hits = 0
        for i, accepted in enumerate(blanks):
            if i < len(given) and normalize_blank(given[i], cs) in {
                normalize_blank(a, cs) for a in accepted
            }:
                hits += 1
        if hits == len(blanks):
            return GradeResult(score=marks, correct=True, needs_manual=False)
        return GradeResult(
            score=_q(marks * Decimal(hits) / Decimal(len(blanks))),
            correct=False,
            needs_manual=False,
        )

    raise ValueError(f"unknown question type {qtype}")


def strip_key(q: dict[str, Any]) -> dict[str, Any]:
    """Question as sent to a student: no correct flags, no answer key, no explanation."""
    out = {k: v for k, v in q.items() if k not in ("answer", "explanation", "rubric")}
    out["options"] = [{k: v for k, v in o.items() if k != "correct"} for o in q.get("options", [])]
    if q["type"] == "fill_blank":
        out["blank_count"] = len(q.get("answer", {}).get("blanks", []))
    if q["type"] == "multi_select":
        out["select_count"] = len(correct_option_ids(q))
    return out


def key_for_review(q: dict[str, Any]) -> dict[str, Any]:
    """Correct answer in a student-friendly shape for review / instant feedback."""
    if q["type"] == "fill_blank":
        return {"blanks": [a[0] if a else "" for a in q.get("answer", {}).get("blanks", [])]}
    if q["type"] in ("mcq", "true_false", "justify", "multi_select"):
        return {"choices": sorted(correct_option_ids(q))}
    return {}
