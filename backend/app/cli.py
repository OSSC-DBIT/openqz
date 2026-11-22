"""Management commands.

python -m app.cli create-admin --email admin@dbit.in --name "Admin"   (prompts for password)
python -m app.cli create-admin --from-env                             (ADMIN_* env vars)
python -m app.cli optimize-media [--dry-run]                          (shrink images already stored)
"""

import argparse
import asyncio
import getpass
import hashlib
import os
import sys
from pathlib import Path

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import func, or_, select

from app.core.crypto import email_index
from app.core.db import SessionLocal, engine
from app.core.security import hash_password, validate_password_strength
from app.models import Media, Role, User
from app.services.images import BadImage, prepare


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
                    User.email_hash == email_index(email),
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
                is_superadmin=True,  # the first admin holds every power
                password_hash=hash_password(password),
                must_change_password=force_change,
            )
        )
        await session.commit()
    await engine.dispose()
    print(f"admin created: sign in with {email}")
    return 0


async def optimize_media(dry_run: bool) -> int:
    """Shrink every stored image the way new uploads are shrunk (services/images.py).

    The image keeps its id, so questions that show it keep working. The new file is written
    first, the row updated and saved, and only then is the old file deleted."""
    kinds = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    before = after = changed = skipped = 0
    async with SessionLocal() as session:
        rows = list((await session.scalars(select(Media).order_by(Media.created_at))).all())
        for m in rows:
            old = Path(m.path)
            if not old.exists():
                skipped += 1
                continue
            data = old.read_bytes()
            try:
                small = prepare(data, m.content_type, kinds.get(m.content_type, old.suffix))
            except BadImage as exc:
                print(f"skip {m.id}: {exc}")
                skipped += 1
                continue
            before += len(data)
            if small.data == data:
                after += len(data)
                continue
            after += len(small.data)
            changed += 1
            if dry_run:
                continue
            new = old.with_suffix(small.ext)
            if new == old:
                new = old.with_name(f"{old.stem}.min{small.ext}")
            new.write_bytes(small.data)
            m.path, m.content_type, m.size = str(new), small.content_type, len(small.data)
            m.sha256 = hashlib.sha256(small.data).hexdigest()
            await session.commit()
            old.unlink(missing_ok=True)
    mb = 1024 * 1024
    verb = "would shrink" if dry_run else "shrank"
    print(
        f"{len(rows)} images: {verb} {changed}, {skipped} skipped; "
        f"{before / mb:.1f} MB -> {after / mb:.1f} MB"
    )
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
    om = sub.add_parser("optimize-media", help="shrink images uploaded before shrinking existed")
    om.add_argument("--dry-run", action="store_true", help="only report what would change")
    args = parser.parse_args()

    if args.cmd == "optimize-media":
        return asyncio.run(optimize_media(args.dry_run))

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
