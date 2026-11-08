import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (
        UniqueConstraint("department_id", "semester", "name", "academic_year", name="uq_section"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"))
    semester: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(16))
    academic_year: Mapped[str] = mapped_column(String(9))  # e.g. 2026-27

    department = relationship("Department", lazy="joined")


class StudentSection(Base):
    __tablename__ = "student_sections"

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    section_id: Mapped[int] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    semester: Mapped[int | None] = mapped_column(Integer, nullable=True)


class FacultyAssignment(Base):
    __tablename__ = "faculty_assignments"
    __table_args__ = (
        UniqueConstraint("faculty_id", "section_id", "subject_id", name="uq_faculty_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    faculty_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"))

    section = relationship("Section", lazy="joined")
    subject = relationship("Subject", lazy="joined")
