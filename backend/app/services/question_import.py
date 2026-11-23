"""Bring questions in from somewhere else: a public Google Form, a spreadsheet, or pasted text.

Every source ends as the same preview: a list of questions in the shape the editor saves
(`QuestionIn`), plus what was left out and why. Nothing is stored here; the teacher reviews the
preview, marks the correct answers where the source had none, and only then adds them.

No AI anywhere: these are plain parsers.
"""

import csv
import io
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from html import unescape
from typing import Any
from urllib.parse import urlsplit

MAX_QUESTIONS = 200
MAX_OPTIONS = 10
MAX_FORM_BYTES = 3 * 1024 * 1024
FORM_HOSTS = {"docs.google.com", "forms.gle"}
LETTERS = "abcdefghij"


class ImportProblem(Exception):
    """The source could not be read; the message is safe to show."""


@dataclass
class Preview:
    title: str | None = None
    questions: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)

    def skip(self, what: str, why: str) -> None:
        self.skipped.append({"title": what.strip()[:120] or "(no title)", "reason": why})

    def as_dict(self) -> dict[str, Any]:
        return {"title": self.title, "questions": self.questions, "skipped": self.skipped}


def _clean(text: Any) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", str(text or "")).strip()


def _options(texts: list[str], correct: set[int] | None = None) -> list[dict[str, Any]]:
    out = []
    for i, t in enumerate(texts[:MAX_OPTIONS]):
        out.append({"id": LETTERS[i], "text": t[:1000], "correct": bool(correct and i in correct)})
    return out


def _question(
    qtype: str,
    stem: str,
    *,
    options: list[dict[str, Any]] | None = None,
    answer: dict[str, Any] | None = None,
    marks: Any = 1,
    explanation: str | None = None,
    seconds: int | None = None,
) -> dict[str, Any]:
    opts = options or []
    if qtype in ("mcq", "justify"):
        needs_key = sum(1 for o in opts if o["correct"]) != 1
    elif qtype == "multi_select":
        needs_key = not any(o["correct"] for o in opts)
    elif qtype == "true_false":
        needs_key = not isinstance((answer or {}).get("value"), bool)
    elif qtype == "fill_blank":
        needs_key = not (answer or {}).get("blanks")
    else:
        needs_key = False
    return {
        "type": qtype,
        "stem": stem[:5000],
        "options": opts,
        "answer": answer or {},
        "marks": str(marks),
        "partial_credit": True,
        "explanation": (explanation or None) and explanation[:5000],
        "tags": [],
        "time_limit_seconds": seconds,
        "rubric": [],
        # for the review screen only: the teacher still has to mark what is right
        "needs_key": needs_key,
    }


# ---------------------------------------------------------------- Google Forms

_FORM_DATA = re.compile(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\])\s*;\s*</script>", re.DOTALL)

# Item types in a public form's data.
_SHORT, _PARAGRAPH, _CHOICE, _DROPDOWN, _CHECKBOX, _SCALE = 0, 1, 2, 3, 4, 5
_SKIP_WHY = {
    6: "A title block, not a question",
    7: "Grid questions have no match here",
    8: "A section break, not a question",
    9: "Date questions have no match here",
    10: "Time questions have no match here",
    11: "An image block, not a question",
    12: "A video block, not a question",
    13: "File upload questions have no match here",
}


def check_form_url(url: str) -> str:
    """Only a Google Forms address is ever fetched (never an arbitrary one a user typed)."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or host not in FORM_HOSTS or parts.username or parts.port:
        raise ImportProblem(
            "Paste the link of a Google Form (it starts with https://docs.google.com/forms/ "
            "or https://forms.gle/)"
        )
    if host == "docs.google.com" and not parts.path.startswith("/forms/"):
        raise ImportProblem(
            "That is a Google link, but not a form. Open the form and copy its link."
        )
    if host == "docs.google.com":
        # /edit needs the owner's sign-in; /viewform is the page anyone with the link can open.
        path = re.sub(r"/(edit|prefill|viewanalytics)[^/]*$", "/viewform", parts.path)
        return f"https://docs.google.com{path}"
    return f"https://forms.gle{parts.path}"


class _FormsOnly(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only while it stays on Google Forms (forms.gle sends one)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        parts = urlsplit(newurl)
        if parts.scheme != "https" or (parts.hostname or "").lower() not in FORM_HOSTS:
            raise ImportProblem(
                "This form asks for a Google sign-in. In the form settings, let anyone with "
                "the link respond, then try again."
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_form_html(url: str) -> str:
    """Blocking: call it in a thread. Reads the public page of a form, with a size cap."""
    opener = urllib.request.build_opener(_FormsOnly)
    req = urllib.request.Request(  # noqa: S310 - host and scheme are checked in check_form_url
        check_form_url(url),
        headers={"User-Agent": "Mozilla/5.0 OpenQZ-import", "Accept-Language": "en"},
    )
    try:
        with opener.open(req, timeout=12) as resp:  # noqa: S310
            data = resp.read(MAX_FORM_BYTES + 1)
    except ImportProblem:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ImportProblem(
                "This form is private. Let anyone with the link respond, then try again."
            ) from exc
        if exc.code == 404:
            raise ImportProblem("No form at that link. Check that it was copied whole.") from exc
        raise ImportProblem("Google did not return the form. Try again in a minute.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImportProblem(
            "Could not reach Google Forms from the server. Try again, or use a spreadsheet."
        ) from exc
    if len(data) > MAX_FORM_BYTES:
        raise ImportProblem("That form is too large to import")
    return data.decode("utf-8", errors="replace")


def parse_google_form(html: str) -> Preview:
    """Read the questions out of a form's public page.

    The page never contains the answer key (even for a form in quiz mode), so choice
    questions arrive without one and the teacher marks it during review."""
    m = _FORM_DATA.search(html)
    if not m:
        raise ImportProblem(
            "Could not read that page as a Google Form. The form may be closed or need a "
            "sign-in: let anyone with the link respond, then try again."
        )
    try:
        data = json.loads(m.group(1))
        info = data[1]
        items = info[1] or []
    except (ValueError, IndexError, TypeError) as exc:
        raise ImportProblem("Could not read that Google Form") from exc

    def at(obj: Any, *path: int) -> Any:
        for i in path:
            if not isinstance(obj, list) or len(obj) <= i:
                return None
            obj = obj[i]
        return obj

    out = Preview(title=_clean(at(info, 8) or at(data, 3) or "") or None)
    for item in items:
        title = _clean(unescape(str(at(item, 1) or "")))
        help_text = _clean(unescape(str(at(item, 2) or "")))
        kind = at(item, 3)
        if kind in _SKIP_WHY:
            if kind not in (6, 8, 11, 12):  # blocks that are not questions are not worth listing
                out.skip(title, _SKIP_WHY[kind])
            continue
        if not title:
            continue
        if len(out.questions) >= MAX_QUESTIONS:
            out.skip(title, f"Only the first {MAX_QUESTIONS} questions are imported")
            continue
        stem = f"{title}\n\n{help_text}" if help_text else title
        entry = at(item, 4, 0)
        texts = [
            _clean(o[0]) for o in (at(entry, 1) or []) if isinstance(o, list) and o and _clean(o[0])
        ]
        if kind in (_CHOICE, _DROPDOWN):
            if len(texts) < 2:
                out.skip(title, "Needs at least two options")
                continue
            out.questions.append(_question("mcq", stem, options=_options(texts)))
        elif kind == _CHECKBOX:
            if len(texts) < 2:
                out.skip(title, "Needs at least two options")
                continue
            out.questions.append(_question("multi_select", stem, options=_options(texts)))
        elif kind == _SCALE:
            if len(texts) < 2:
                out.skip(title, "A scale with no steps")
                continue
            out.questions.append(_question("mcq", stem, options=_options(texts)))
        elif kind in (_SHORT, _PARAGRAPH):
            out.questions.append(_question("open_ended", stem))
        else:
            out.skip(title, "This kind of question has no match here")
    if not out.questions and not out.skipped:
        raise ImportProblem("That form has no questions")
    return out


# ---------------------------------------------------------------- spreadsheets

_TYPE_WORDS = {
    "mcq": "mcq",
    "multiple choice": "mcq",
    "single": "mcq",
    "choice": "mcq",
    "multi": "multi_select",
    "multi select": "multi_select",
    "multi-select": "multi_select",
    "multiselect": "multi_select",
    "checkbox": "multi_select",
    "checkboxes": "multi_select",
    "true false": "true_false",
    "true/false": "true_false",
    "true / false": "true_false",
    "tf": "true_false",
    "boolean": "true_false",
    "fill": "fill_blank",
    "fill blank": "fill_blank",
    "fill in the blank": "fill_blank",
    "fill in the blanks": "fill_blank",
    "blank": "fill_blank",
    "open": "open_ended",
    "open ended": "open_ended",
    "open-ended": "open_ended",
    "essay": "open_ended",
    "paragraph": "open_ended",
    "short answer": "open_ended",
    "justify": "justify",
}
_TRUE = {"true", "t", "yes", "y", "1"}
_FALSE = {"false", "f", "no", "n", "0"}


def _rows(data: bytes, filename: str) -> list[list[str]]:
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001 - any broken workbook is the same message
            raise ImportProblem("Could not open that Excel file") from exc
        ws = wb.worksheets[0]
        return [
            ["" if c is None else str(c) for c in row]
            for row in ws.iter_rows(values_only=True, max_row=MAX_QUESTIONS * 2 + 50)
        ]
    if name.endswith((".csv", ".tsv", ".txt")):
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect: Any = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        return [list(r) for r in csv.reader(io.StringIO(text), dialect)]
    raise ImportProblem("Use a .csv or .xlsx file")


def _col(header: list[str], *names: str) -> int | None:
    for i, h in enumerate(header):
        if h in names:
            return i
    return None


def _correct_set(raw: str, texts: list[str]) -> set[int]:
    """`B`, `b, d`, `2`, `1;3` or the option text itself."""
    found: set[int] = set()
    whole = _clean(raw).lower()
    if not whole:
        return found
    by_text = {t.lower(): i for i, t in enumerate(texts)}
    if whole in by_text:
        return {by_text[whole]}
    for part in re.split(r"[,;|/]+|\s+and\s+", whole):
        p = part.strip().strip(".)")
        if not p:
            continue
        if p in by_text:
            found.add(by_text[p])
        elif len(p) == 1 and p in LETTERS[: len(texts)]:
            found.add(LETTERS.index(p))
        elif p.isdigit() and 1 <= int(p) <= len(texts):
            found.add(int(p) - 1)
    return found


def _number(raw: str, default: Any) -> Any:
    try:
        v = float(_clean(raw))
    except ValueError:
        return default
    return int(v) if v == int(v) else v


def parse_sheet(data: bytes, filename: str) -> Preview:
    """One question per row. Columns (any order, header row required):
    Question, Type, Option A ... Option J (or Option 1 ...), Correct, Marks, Time, Explanation."""
    rows = [r for r in _rows(data, filename) if any(_clean(c) for c in r)]
    if len(rows) < 2:
        raise ImportProblem("The sheet needs a header row and at least one question")
    header = [re.sub(r"[^a-z0-9 ]", "", _clean(h).lower()) for h in rows[0]]
    q_col = _col(header, "question", "questions", "question text", "stem", "prompt")
    if q_col is None:
        raise ImportProblem('The first row must name the columns, with one called "Question"')
    type_col = _col(header, "type", "question type", "kind")
    correct_col = _col(
        header, "correct", "answer", "correct answer", "answers", "key", "correct answers"
    )
    marks_col = _col(header, "marks", "mark", "points", "score")
    time_col = _col(header, "time", "seconds", "timer", "time limit", "time seconds")
    why_col = _col(header, "explanation", "explain", "solution", "feedback")
    opt_cols = [
        i
        for i, h in enumerate(header)
        if re.fullmatch(r"(option|choice|opt)? ?([a-j]|[0-9]{1,2})", h) and i != q_col
    ]

    def cell(row: list[str], i: int | None) -> str:
        return _clean(row[i]) if i is not None and i < len(row) else ""

    out = Preview()
    for n, row in enumerate(rows[1:], start=2):
        stem = cell(row, q_col)
        if not stem:
            continue
        if len(out.questions) >= MAX_QUESTIONS:
            out.skip(stem, f"Only the first {MAX_QUESTIONS} questions are imported")
            continue
        texts = [t for t in (cell(row, i) for i in opt_cols) if t][:MAX_OPTIONS]
        raw_type = re.sub(r"[_]+", " ", cell(row, type_col).lower())
        correct_raw = cell(row, correct_col)
        qtype = _TYPE_WORDS.get(raw_type)
        if raw_type and qtype is None:
            out.skip(stem, f'Row {n}: unknown type "{cell(row, type_col)}"')
            continue
        marks = _number(cell(row, marks_col), 1)
        if not isinstance(marks, (int, float)) or not 0 <= marks <= 100:
            marks = 1
        seconds = _number(cell(row, time_col), None)
        seconds = (
            int(seconds) if isinstance(seconds, (int, float)) and 5 <= seconds <= 3600 else None
        )
        why = cell(row, why_col) or None
        common: dict[str, Any] = {"marks": marks, "explanation": why, "seconds": seconds}

        if qtype is None:  # work it out from what the row has
            if texts:
                qtype = "multi_select" if len(_correct_set(correct_raw, texts)) > 1 else "mcq"
            elif correct_raw.lower() in _TRUE | _FALSE:
                qtype = "true_false"
            elif "___" in stem and correct_raw:
                qtype = "fill_blank"
            else:
                qtype = "open_ended"

        if qtype in ("mcq", "justify", "multi_select"):
            if len(texts) < 2:
                out.skip(stem, f"Row {n}: needs at least two options")
                continue
            right = _correct_set(correct_raw, texts)
            if qtype != "multi_select" and len(right) > 1:
                right = set()  # the teacher picks the one during review
            out.questions.append(_question(qtype, stem, options=_options(texts, right), **common))
        elif qtype == "true_false":
            low = correct_raw.lower()
            value = True if low in _TRUE else False if low in _FALSE else None
            out.questions.append(
                _question(
                    "true_false",
                    stem,
                    options=[
                        {"id": "true", "text": "True", "correct": value is True},
                        {"id": "false", "text": "False", "correct": value is False},
                    ],
                    answer={} if value is None else {"value": value},
                    **common,
                )
            )
        elif qtype == "fill_blank":
            # blanks are separated by ";" and alternatives by "|": "Paris; 1789 | seventeen eighty nine"
            blanks = [
                [a.strip() for a in b.split("|") if a.strip()]
                for b in correct_raw.split(";")
                if b.strip()
            ]
            markers = stem.count("___")
            if not blanks or (markers and markers != len(blanks)):
                out.skip(
                    stem,
                    f'Row {n}: write one answer per "___" in the Correct column, separated by ;',
                )
                continue
            out.questions.append(
                _question(
                    "fill_blank", stem, answer={"blanks": blanks, "case_sensitive": False}, **common
                )
            )
        else:
            out.questions.append(_question("open_ended", stem, **common))
    if not out.questions and not out.skipped:
        raise ImportProblem("No questions found in that sheet")
    return out


# ---------------------------------------------------------------- pasted text

_OPTION_LINE = re.compile(r"^\s*(\*)?\s*(?:\(?([A-Ja-j]|\d{1,2})[).:]|[-•])\s+(.+?)\s*(\*)?\s*$")
_ANSWER_LINE = re.compile(r"^\s*(?:ans(?:wer)?|correct|key)\s*[:=-]\s*(.+?)\s*$", re.IGNORECASE)
_NUMBERING = re.compile(r"^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[).:-]\s+", re.IGNORECASE)


def parse_text(text: str) -> Preview:
    """Questions typed or pasted as plain text, one block per question, blank line between:

        1. Capital of France?
        A) London
        *B) Paris
        C) Rome
        Answer: B          (instead of the star)

    A block with no options and `Answer: true` / `false` is a True / False question; with no
    options and no answer it is an open-ended one."""
    out = Preview()
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        stem_lines: list[str] = []
        texts: list[str] = []
        starred: set[int] = set()
        answer_raw = ""
        for ln in lines:
            ans = _ANSWER_LINE.match(ln)
            opt = _OPTION_LINE.match(ln)
            if ans:
                answer_raw = ans.group(1)
            elif opt and (stem_lines or texts):
                if opt.group(1) or opt.group(4):
                    starred.add(len(texts))
                texts.append(_clean(opt.group(3)))
            elif texts:
                texts[-1] = f"{texts[-1]} {_clean(ln)}"  # a wrapped option line
            else:
                stem_lines.append(_clean(ln))
        stem = _NUMBERING.sub("", " ".join(stem_lines)).strip()
        if not stem:
            continue
        if len(out.questions) >= MAX_QUESTIONS:
            out.skip(stem, f"Only the first {MAX_QUESTIONS} questions are imported")
            continue
        texts = texts[:MAX_OPTIONS]
        if len(texts) >= 2:
            right = starred or _correct_set(answer_raw, texts)
            qtype = "multi_select" if len(right) > 1 else "mcq"
            out.questions.append(_question(qtype, stem, options=_options(texts, right)))
        elif len(texts) == 1:
            out.skip(stem, "Needs at least two options")
        elif answer_raw.lower() in _TRUE | _FALSE:
            value = answer_raw.lower() in _TRUE
            out.questions.append(
                _question(
                    "true_false",
                    stem,
                    options=[
                        {"id": "true", "text": "True", "correct": value},
                        {"id": "false", "text": "False", "correct": not value},
                    ],
                    answer={"value": value},
                )
            )
        elif "___" in stem and answer_raw:
            blanks = [
                [a.strip() for a in b.split("|") if a.strip()]
                for b in answer_raw.split(";")
                if b.strip()
            ]
            if stem.count("___") != len(blanks):
                out.skip(stem, 'Write one answer per "___", separated by ;')
                continue
            out.questions.append(
                _question("fill_blank", stem, answer={"blanks": blanks, "case_sensitive": False})
            )
        else:
            out.questions.append(_question("open_ended", stem))
    if not out.questions and not out.skipped:
        raise ImportProblem("No questions found in that text")
    return out
