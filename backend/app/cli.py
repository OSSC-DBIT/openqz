"""Management commands.

python -m app.cli create-admin --email admin@dbit.in --name "Admin"   (prompts for password)
python -m app.cli create-admin --from-env                             (ADMIN_* env vars)
"""

import argparse
import asyncio
import getpass
import os
import sys

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import func, or_, select

from app.core.db import SessionLocal, engine
from app.core.security import hash_password, validate_password_strength
from app.models import Role, User


async def create_admin(
    username: str, email: str, full_name: str, password: str, force_change: bool
) -> int:
    try:
        # Same rules as the API (pydantic EmailStr), so the admin can edit it later in the UI.
        email = validate_email(email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        print(f"error: a valid admin email is required (it is the login): {exc}", file=sys.stderr)
        return 1
    problem = validate_password_strength(password)
    if problem:
        print(f"error: {problem}", file=sys.stderr)
        return 1
    async with SessionLocal() as session:
        existing = await session.scalar(
            select(User).where(
                or_(
                    func.upper(User.username) == username.upper(),
                    func.lower(User.email) == email,
                )
            )
        )
        if existing:
            if not existing.email:
                # Upgrade path: accounts created before email login had no email.
                existing.email = email
                await session.commit()
                print(f"user '{existing.username}' already exists; email set to {email}")
            else:
                print(
                    f"user '{existing.username}' ({existing.email}) already exists; nothing to do"
                )
            await engine.dispose()
            return 0
        session.add(
            User(
                username=username,
                email=email,
                full_name=full_name,
                role=Role.admin,
                password_hash=hash_password(password),
                must_change_password=force_change,
            )
        )
        await session.commit()
    await engine.dispose()
    print(f"admin created: sign in with {email}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    ca = sub.add_parser("create-admin")
    ca.add_argument("--username", default="admin", help="internal id shown in the UI")
    ca.add_argument("--email", default="")
    ca.add_argument("--name", default="OpenQZ Administrator")
    ca.add_argument("--from-env", action="store_true")
    ca.add_argument("--no-force-change", action="store_true")
    args = parser.parse_args()

    if args.cmd == "create-admin":
        if args.from_env:
            username = os.environ.get("ADMIN_USERNAME", "admin")
            email = os.environ.get("ADMIN_EMAIL", "")
            name = os.environ.get("ADMIN_FULL_NAME", args.name)
            password = os.environ.get("ADMIN_PASSWORD", "")
        else:
            username, email, name = args.username, args.email, args.name
            password = getpass.getpass("Password: ")
            if password != getpass.getpass("Repeat: "):
                print("error: passwords do not match", file=sys.stderr)
                return 1
        return asyncio.run(create_admin(username, email, name, password, not args.no_force_change))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
