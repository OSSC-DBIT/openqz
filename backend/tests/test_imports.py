import io

from httpx import AsyncClient
from openpyxl import Workbook

from app.models import ImportKind
from app.services.import_parser import suggest_header_map

STUDENTS_CSV = (
    "Roll No,Student Name,Branch,Sem,Section,Email ID\n"
    "1db23cs001,Asha K,CSE,5,A,Asha@Example.com\n"
    "1DB23CS002,Bharath M,CSE,5th,A,bharath@example.com\n"
    "1DB23CS002,Duplicate Row,CSE,5,A,dup@example.com\n"
    "1DB23CS003,,CSE,5,B,c3@example.com\n"
    "1DB23CS004,Chetan R,CSE,12,B,not-an-email\n"
    "1DB23CS005,No Email,CSE,5,B,\n"
    "1DB23CS006,Same Email,CSE,5,B,asha@example.com\n"
)


def test_header_aliases() -> None:
    hm = suggest_header_map(
        ImportKind.students, ["Roll No", "Student Name", "Branch", "Sem", "Section", "Email ID"]
    )
    assert hm == {
        "usn": "Roll No",
        "full_name": "Student Name",
        "department": "Branch",
        "semester": "Sem",
        "section": "Section",
        "email": "Email ID",
    }


async def _upload(client: AsyncClient, headers: dict[str, str], kind: str, name: str, data: bytes):
    r = await client.post(
        "/api/v1/imports",
        headers=headers,
        data={"kind": kind, "academic_year": "2026-27"},
        files={"file": (name, data)},
    )
    assert r.status_code == 201, r.text
    return (await client.get(f"/api/v1/imports/{r.json()['id']}", headers=headers)).json()


async def test_student_import_preview_commit_pdf(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    job = await _upload(client, admin_headers, "students", "s.csv", STUDENTS_CSV.encode())
    assert job["status"] == "preview"
    assert job["total_rows"] == 7
    assert job["valid_rows"] == 2
    error_rows = {e["row"]: e["errors"] for e in job["error_rows"]}
    assert any("duplicate" in m for m in error_rows[4])
    assert "full_name is required" in error_rows[5]
    assert len(error_rows[6]) == 2  # semester out of range + bad email
    assert "email is required" in error_rows[7]
    assert any("duplicate email" in m for m in error_rows[8])

    c = await client.post(f"/api/v1/imports/{job['id']}/commit", headers=admin_headers)
    assert c.status_code == 200
    done = (await client.get(f"/api/v1/imports/{job['id']}", headers=admin_headers)).json()
    assert done["status"] == "done", done["message"]
    assert done["created_count"] == 2
    assert done["has_credentials"] is True

    pdf = await client.get(f"/api/v1/imports/{job['id']}/credentials.pdf", headers=admin_headers)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")

    users = await client.get("/api/v1/users?role=student", headers=admin_headers)
    assert {u["username"] for u in users.json()["items"]} == {"1DB23CS001", "1DB23CS002"}

    # re-import is idempotent: updates, no new credentials
    again = await _upload(client, admin_headers, "students", "s.csv", STUDENTS_CSV.encode())
    await client.post(f"/api/v1/imports/{again['id']}/commit", headers=admin_headers)
    again = (await client.get(f"/api/v1/imports/{again['id']}", headers=admin_headers)).json()
    assert again["created_count"] == 0 and again["updated_count"] == 2

    purge = await client.delete(f"/api/v1/imports/{job['id']}/credentials", headers=admin_headers)
    assert purge.status_code == 204


async def test_xlsx_faculty_then_mapping(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    wb = Workbook()
    ws = wb.active
    ws.append(["Emp ID", "Faculty Name", "Dept", "Email"])
    ws.append(["EMP01", "Dr. Kavya", "CSE", "kavya@example.com"])
    ws.append(["EMP02", "Prof. Ravi", "ISE", "ravi@example.com"])
    buf = io.BytesIO()
    wb.save(buf)
    fac = await _upload(client, admin_headers, "faculty", "f.xlsx", buf.getvalue())
    assert fac["valid_rows"] == 2, fac
    await client.post(f"/api/v1/imports/{fac['id']}/commit", headers=admin_headers)

    mapping_csv = (
        "Employee ID,Department,Semester,Section,Subject Code,Subject Name\n"
        "EMP01,CSE,5,A,BCS501,Software Engineering\n"
        "EMP99,CSE,5,A,BCS502,Unknown Faculty\n"
    )
    m = await _upload(client, admin_headers, "mapping", "m.csv", mapping_csv.encode())
    assert m["valid_rows"] == 1
    assert "not found" in m["error_rows"][0]["errors"][0]
    await client.post(f"/api/v1/imports/{m['id']}/commit", headers=admin_headers)
    rows = (await client.get("/api/v1/assignments", headers=admin_headers)).json()
    assert len(rows) == 1 and rows[0]["subject_name"] == "Software Engineering"


async def test_manual_header_mapping(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    csv = "ID,Who,D,S,Sec,Mail\n1DB23CS050,Zoya,CSE,3,C,zoya@example.com\n"
    job = await _upload(client, admin_headers, "students", "x.csv", csv.encode())
    assert job["valid_rows"] == 0
    assert "Map these columns" in job["message"]
    r = await client.put(
        f"/api/v1/imports/{job['id']}/mapping",
        headers=admin_headers,
        json={
            "header_map": {
                "usn": "ID",
                "full_name": "Who",
                "department": "D",
                "semester": "S",
                "section": "Sec",
                "email": "Mail",
            }
        },
    )
    assert r.status_code == 200
    job = (await client.get(f"/api/v1/imports/{job['id']}", headers=admin_headers)).json()
    assert job["valid_rows"] == 1


async def test_rejects_bad_file(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    r = await client.post(
        "/api/v1/imports",
        headers=admin_headers,
        data={"kind": "students"},
        files={"file": ("evil.exe", b"MZ")},
    )
    assert r.status_code == 400


async def test_email_already_used_by_another_user(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    from tests.conftest import make_user

    await make_user("EMP77", email="taken@example.com")
    csv = "USN,Name,Dept,Sem,Section,Email\n1DB23CS090,New Kid,CSE,1,A,TAKEN@example.com\n"
    job = await _upload(client, admin_headers, "students", "t.csv", csv.encode())
    assert job["valid_rows"] == 0
    assert "already belongs to EMP77" in job["error_rows"][0]["errors"][0]
