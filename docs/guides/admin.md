# OpenQZ admin guide

The admin sets up departments, classes and accounts, imports the office sheets, and looks after sign-in problems. Server tasks (deploy, TLS, backups) are in the [runbook](https://github.com/ossc-dbit/openqz/blob/main/docs/runbook.md).

## 1. First sign-in

Use the admin email and temporary password from the server setup, then choose your own password. Every page is in the left menu.

## 2. Bring everyone in (start of term)

Import in this order from **Imports**:

1. **Faculty**: Employee ID, Full Name, Email, Department.
2. **Students**: USN, Full Name, Email, Department, Semester, Section.
3. **Faculty-section-subject mapping**: Employee ID, Department, Semester, Section, Subject Code, Subject Name.

Download the templates on the Imports page. Column names are matched loosely ("Roll No" works for USN, "Emp ID" for Employee ID). **Everyone needs a unique email**: it is how they sign in.

For each upload:

1. Pick the type and the **academic year**, choose the `.csv` or `.xlsx` file, press **Upload and preview**.
2. Check the **Column mapping** and fix any column OpenQZ could not match, then **Re-check**.
3. Rows with problems are listed with the reason (missing field, invalid email, duplicate USN or email, email already used by someone else, faculty not found). They will be skipped. Fix them in the sheet and import again later if needed.
4. Press **Import N valid rows**.
5. Download **Credential slips (PDF)**: one slip per new account with the email and temporary password, grouped by section. Print them, give them to class teachers, then press **Delete PDF from server**.

Re-importing the same sheet is safe: existing people are updated, nobody is duplicated, and no new passwords are made for existing accounts. A student who moved section is moved.

## 3. Day-to-day tasks

| Task | Where |
| --- | --- |
| Add one person | **Users**, then **Add user** (gives a temporary password to hand over). |
| Reset a password | **Users**, key icon. Gives a new temporary password; they must change it at next sign-in. |
| Unlock an account | **Users**, lock icon (accounts lock for 15 minutes after 5 wrong passwords). |
| Change someone's sign-in email | **Users**, mail icon. Their old Google link is removed. |
| Disable / enable an account | **Users**, **Disable**. Disabled people cannot sign in; their work is kept. |
| Departments and sections | **Sections**. Sections belong to an academic year (for example 2026-27). |
| Subjects | **Subjects**. |
| Who teaches what | **Faculty mapping**. Faculty only see and assign to sections mapped here. Map a teacher to sections of several branches (for example first-year maths for CSE and ECE) and they can pick any of them. |
| Club accounts | **Users**, then **Add user**, role **Club organiser**. Use the club's shared email (for example `techclub@...`). |

### Club organisers

A club organiser (tech club, cultural committee, placement cell) can build activities and **host rooms** with a join code, which any signed-in student can join. They cannot assign to classes, see class lists, import people or open other people's activities and reports. Disable the account when the club's term ends; its results are kept.

## 4. Sign-in options

- **Email and password** always works.
- **Continue with Google** appears when the server has a Google client id. It only signs in people whose email you imported. See the runbook section *Google sign-in*.
- **Forgot your password?** appears when the server has email (SMTP) set up. Otherwise people ask you to reset it.

## 5. Watching over things

- **Integrity log**: tab switches, Back presses, reloads during quizzes.
- **Audit log**: sign-ins, failed sign-ins, lockouts, password resets, imports, credential downloads, score releases. Filter by action or search by person.
- **Dashboard**: counts of students, faculty, sections and teaching assignments for the current academic year.

Admins can also open the faculty **Library** and **Reports** to see every activity.

## 6. Privacy

- Credential slips contain passwords: print, hand out, then delete the PDF from the server.
- Passwords are stored as one-way hashes; nobody, including the admin, can see them.
- Export only what you need, and keep downloaded files on college devices.
