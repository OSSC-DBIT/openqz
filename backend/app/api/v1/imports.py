import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core.config import get_settings
from app.core.deps import AdminUser, SessionDep
from app.models import ImportJob, ImportKind, ImportStatus
from app.schemas.imports import HeaderMapIn, ImportFieldsOut, ImportJobOut
from app.services import audit, import_service

router = APIRouter(prefix="/imports", tags=["imports"])

ALLOWED = {".csv", ".xlsx"}


def default_academic_year() -> str:
    now = datetime.now(UTC)
    start = now.year if now.month >= 7 else now.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def to_out(job: ImportJob) -> ImportJobOut:
    out = ImportJobOut.model_validate(job)
    out.has_credentials = bool(job.credential_pdf_path)
    return out


async def enqueue(request: Request, task: str, job_id: uuid.UUID) -> None:
    pool = getattr(request.app.state, "arq", None)
    if pool is None:
        # Inline mode (tests / no worker): run the task in-process.
        from app.core.db import SessionLocal

        async with SessionLocal() as s:
            if task == "parse_import":
                await import_service.parse_job(s, job_id)
            else:
                await import_service.commit_job(s, job_id)
        return
    await pool.enqueue_job(task, str(job_id))


@router.get("/fields", response_model=list[ImportFieldsOut])
async def fields(_: AdminUser) -> list[ImportFieldsOut]:
    return [
        ImportFieldsOut(kind=k, required=r, optional=o)
        for k in ImportKind
        for r, o in [import_service.fields_for(k)]
    ]


@router.get("", response_model=list[ImportJobOut])
async def list_jobs(session: SessionDep, _: AdminUser) -> list[ImportJobOut]:
    rows = await session.scalars(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(50))
    return [to_out(j) for j in rows]


@router.post("", response_model=ImportJobOut, status_code=201)
async def upload(
    request: Request,
    session: SessionDep,
    admin: AdminUser,
    kind: Annotated[ImportKind, Form()],
    file: Annotated[UploadFile, File()],
    academic_year: Annotated[str | None, Form(pattern=r"^\d{4}-\d{2}$")] = None,
) -> ImportJobOut:
    s = get_settings()
    name = Path(file.filename or "upload").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload a .csv or .xlsx file")
    data = await file.read(s.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")
    if ext == ".xlsx" and not data.startswith(b"PK"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not a valid .xlsx workbook")

    job_id = uuid.uuid4()
    folder = import_service.job_dir(job_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"source{ext}"
    path.write_bytes(data)

    job = ImportJob(
        id=job_id,
        kind=kind,
        status=ImportStatus.uploaded,
        original_filename=name[:255],
        file_path=str(path),
        academic_year=academic_year or default_academic_year(),
        created_by=admin.id,
    )
    session.add(job)
    audit.record(
        session,
        "import_uploaded",
        actor_id=admin.id,
        target=str(job_id),
        meta={"kind": kind.value, "file": name},
    )
    await session.commit()
    await enqueue(request, "parse_import", job_id)
    await session.refresh(job)
    return to_out(job)


async def _job(session: SessionDep, job_id: uuid.UUID) -> ImportJob:
    job = await session.get(ImportJob, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found")
    return job


@router.get("/{job_id}", response_model=ImportJobOut)
async def get_job(job_id: uuid.UUID, session: SessionDep, _: AdminUser) -> ImportJobOut:
    return to_out(await _job(session, job_id))


@router.put("/{job_id}/mapping", response_model=ImportJobOut)
async def set_mapping(
    job_id: uuid.UUID, body: HeaderMapIn, request: Request, session: SessionDep, _: AdminUser
) -> ImportJobOut:
    job = await _job(session, job_id)
    if job.status not in (ImportStatus.preview, ImportStatus.failed):
        raise HTTPException(status.HTTP_409_CONFLICT, "Import is not in preview")
    headers = set(job.source_headers or [])
    bad = [v for v in body.header_map.values() if v not in headers]
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown columns: {', '.join(bad)}")
    job.header_map = {k: v for k, v in body.header_map.items() if v}
    job.status = ImportStatus.uploaded
    await session.commit()
    await enqueue(request, "parse_import", job_id)
    await session.refresh(job)
    return to_out(job)


@router.post("/{job_id}/commit", response_model=ImportJobOut)
async def commit(
    job_id: uuid.UUID, request: Request, session: SessionDep, _: AdminUser
) -> ImportJobOut:
    job = await _job(session, job_id)
    if job.status != ImportStatus.preview or job.valid_rows == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Nothing valid to import yet")
    job.status = ImportStatus.committing
    await session.commit()
    await enqueue(request, "commit_import", job_id)
    await session.refresh(job)
    return to_out(job)


@router.get("/{job_id}/credentials.pdf")
async def credentials_pdf(job_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> FileResponse:
    job = await _job(session, job_id)
    if not job.credential_pdf_path or not Path(job.credential_pdf_path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No credential sheet for this import")
    audit.record(session, "credentials_downloaded", actor_id=admin.id, target=str(job_id))
    await session.commit()
    return FileResponse(
        job.credential_pdf_path,
        media_type="application/pdf",
        filename=f"openqz-credentials-{job.kind.value}-{str(job.id)[:8]}.pdf",
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{job_id}/credentials", status_code=204)
async def purge_credentials(job_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> Response:
    """Delete the plaintext credential sheet once it has been printed."""
    job = await _job(session, job_id)
    if job.credential_pdf_path:
        Path(job.credential_pdf_path).unlink(missing_ok=True)
        job.credential_pdf_path = None
        audit.record(session, "credentials_purged", actor_id=admin.id, target=str(job_id))
        await session.commit()
    return Response(status_code=204)
