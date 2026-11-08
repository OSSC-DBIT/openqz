# Import sheet formats

Upload `.csv` or `.xlsx` (first sheet) at **Admin -> Imports**. **Every student and faculty member needs an email**: it is how they sign in (email + password, or Continue with Google). The first non-empty row must be the header. Column names are matched loosely: case, spaces and punctuation are ignored, and common aliases work. Anything the importer cannot match can be mapped by hand on the preview screen.

Import in this order: **faculty, then students, then mapping**.

Templates: `frontend/public/templates/` (also downloadable from the Imports page). Example sheets with deliberate errors: `samples/`.

## Students

| Field | Required | Accepted headers | Notes |
| --- | --- | --- | --- |
| usn | yes | USN, Roll No, Register No, Reg No, Student ID | Student ID shown in lists and reports (stored upper case) |
| full_name | yes | Full Name, Name, Student Name | |
| department | yes | Department, Dept, Branch | Code, e.g. CSE. Created if new |
| semester | yes | Semester, Sem | 1 to 10; "5th" works |
| section | yes | Section, Sec, Div | e.g. A. Created for the chosen academic year if new |
| email | yes | Email, Email ID, Mail | Login id. College or personal Gmail; must be unique |

A student belongs to one section per academic year. Re-importing moves them if their section changed.

## Faculty

| Field | Required | Accepted headers |
| --- | --- | --- |
| employee_id | yes | Employee ID, Emp ID, Emp No, Staff ID, Faculty ID |
| full_name | yes | Full Name, Name, Faculty Name, Staff Name |
| department | yes | Department, Dept, Branch |
| email | yes | Email, Email ID |

## Faculty-section-subject mapping

| Field | Required | Accepted headers |
| --- | --- | --- |
| employee_id | yes | Employee ID, Emp ID |
| department | yes | Department, Dept |
| semester | yes | Semester, Sem |
| section | yes | Section, Sec |
| subject_code | yes | Subject Code, Course Code, Sub Code |
| subject_name | no | Subject Name, Course Name, Title |

The faculty member must already exist. Sections and subjects are created if missing.

## What happens on import

1. **Preview:** every row is validated (required fields, formats, duplicate USN/ID or email within the file, an email already used by someone else, role clashes with existing users). Rows with errors are listed and will be skipped.
2. **Import:** valid rows are created or updated in one transaction. Re-importing the same sheet is safe.
3. **Credential slips:** new accounts get a random temporary password. The slip shows the login email and password. Download the PDF (one slip per person, grouped by section), print it, hand slips to class teachers, then **delete the PDF from the server**. Everyone must set their own password at first login, unless they use Continue with Google (that cancels the temporary password).

Limits: 10 MB per file, 20,000 rows.
