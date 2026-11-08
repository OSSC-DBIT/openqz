"""Tolerant CSV/XLSX parsing and row validation for the office import sheets."""

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from app.models import ImportKind

# target field -> accepted header spellings (normalised: lowercase, alnum only)
ALIASES: dict[str, list[str]] = {
    "usn": [
        "usn",
        "rollno",
        "rollnumber",
        "registerno",
        "regno",
        "registrationnumber",
        "studentid",
    ],
    "employee_id": ["employeeid", "empid", "empno", "staffid", "facultyid", "employeecode"],
    "full_name": ["fullname", "name", "studentname", "facultyname", "staffname"],
    "email": ["email", "emailid", "mail", "emailaddress"],
    "department": ["department", "dept", "branch", "deptcode", "departmentcode"],
    "semester": ["semester", "sem"],
    "section": ["section", "sec", "div", "division"],
    "subject_code": ["subjectcode", "coursecode", "subcode", "subject"],
    "subject_name": ["subjectname", "coursename", "subname", "title"],
}

FIELDS: dict[ImportKind, tuple[list[str], list[str]]] = {
    # Email is required: it is the login id (password and Google sign-in).
    ImportKind.students: (["usn", "full_name", "email", "department", "semester", "section"], []),
    ImportKind.faculty: (["employee_id", "full_name", "email", "department"], []),
    ImportKind.mapping: (
        ["employee_id", "department", "semester", "section", "subject_code"],
        ["subject_name"],
    ),
}

MAX_ROWS = 20000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{2,64}$")


def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h).lower())


class ParseError(Exception):
    pass


def read_table(path: Path) -> tuple[list[str], list[list[str]]]:
    """Return (headers, rows) as strings. First non-empty row is the header."""
    suffix = path.suffix.lower()
    raw_rows: list[list[Any]]
    if suffix == ".csv":
        data = path.read_bytes()
        text = None
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise ParseError("Could not decode CSV file")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel  # type: ignore[assignment]
        raw_rows = list(csv.reader(io.StringIO(text), dialect))
    elif suffix in (".xlsx", ".xlsm"):
        try:
            wb = load_workbook(path, read_only=True, data_only=True)
        except Exception as exc:
            raise ParseError(f"Could not open Excel file: {exc}") from exc
        ws = wb.worksheets[0]
        raw_rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
    else:
        raise ParseError("Only .csv and .xlsx files are supported")

    def cell(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v).strip()

    rows = [[cell(v) for v in r] for r in raw_rows]
    rows = [r for r in rows if any(r)]
    if not rows:
        raise ParseError("The file is empty")
    headers, body = rows[0], rows[1:]
    if len(body) > MAX_ROWS:
        raise ParseError(f"Too many rows ({len(body)}); the limit is {MAX_ROWS}")
    return headers, body


def suggest_header_map(kind: ImportKind, headers: list[str]) -> dict[str, str]:
    required, optional = FIELDS[kind]
    normalised = {norm_header(h): h for h in headers if h}
    result: dict[str, str] = {}
    for target in required + optional:
        for alias in ALIASES[target]:
            if alias in normalised:
                result[target] = normalised[alias]
                break
    return result


@dataclass
class Validated:
    valid: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)


def _semester(v: str) -> int | None:
    m = re.search(r"\d+", v)
    if not m:
        return None
    n = int(m.group())
    return n if 1 <= n <= 10 else None


def validate_rows(
    kind: ImportKind, headers: list[str], rows: list[list[str]], header_map: dict[str, str]
) -> Validated:
    required, optional = FIELDS[kind]
    out = Validated()
    out.missing_columns = [f for f in required if f not in header_map]
    if out.missing_columns:
        return out

    index = {h: i for i, h in enumerate(headers)}
    col = {target: index.get(src) for target, src in header_map.items()}
    seen: dict[str, int] = {}
    seen_email: dict[str, int] = {}

    for n, row in enumerate(rows, start=2):  # row 1 is the header

        def get(target: str, _row: list[str] = row) -> str:
            i = col.get(target)
            return _row[i].strip() if i is not None and i < len(_row) else ""

        values = {t: get(t) for t in required + optional if t in col}
        errors: list[str] = []
        for f in required:
            if not values.get(f):
                errors.append(f"{f} is required")

        clean: dict[str, Any] = {}
        key_field = "usn" if kind == ImportKind.students else "employee_id"
        if values.get(key_field):
            username = values[key_field].upper().replace(" ", "")
            if not USERNAME_RE.match(username):
                errors.append(f"{key_field} has invalid characters")
            clean["username"] = username
            if kind != ImportKind.mapping:
                if username in seen:
                    errors.append(f"duplicate {key_field} (also on row {seen[username]})")
                else:
                    seen[username] = n

        if values.get("full_name"):
            clean["full_name"] = " ".join(values["full_name"].split())[:200]
        if values.get("email"):
            email = values["email"].strip().lower()
            if not EMAIL_RE.match(email):
                errors.append("email is not valid")
            elif email in seen_email:
                errors.append(f"duplicate email (also on row {seen_email[email]})")
            else:
                seen_email[email] = n
                clean["email"] = email
        if values.get("department"):
            clean["department"] = values["department"].upper().replace(" ", "")[:16]
        if "semester" in required and values.get("semester"):
            sem = _semester(values["semester"])
            if sem is None:
                errors.append("semester must be 1 to 10")
            clean["semester"] = sem
        if values.get("section"):
            clean["section"] = values["section"].upper().replace(" ", "")[:16]
        if values.get("subject_code"):
            clean["subject_code"] = values["subject_code"].upper().replace(" ", "")[:32]
        if values.get("subject_name"):
            clean["subject_name"] = values["subject_name"][:200]

        if errors:
            out.errors.append({"row": n, "errors": errors, "values": values})
        else:
            clean["row"] = n
            out.valid.append(clean)
    return out
