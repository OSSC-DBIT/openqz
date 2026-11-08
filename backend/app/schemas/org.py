import uuid

from pydantic import BaseModel, ConfigDict, Field


class DepartmentIn(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)


class DepartmentOut(DepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class SectionIn(BaseModel):
    department_id: int
    semester: int = Field(ge=1, le=10)
    name: str = Field(min_length=1, max_length=16)
    academic_year: str = Field(pattern=r"^\d{4}-\d{2}$")


class SectionOut(SectionIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    department_code: str | None = None
    student_count: int = 0


class SubjectIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    department_id: int | None = None
    semester: int | None = Field(default=None, ge=1, le=10)


class SubjectOut(SubjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AssignmentIn(BaseModel):
    faculty_id: uuid.UUID
    section_id: int
    subject_id: int


class AssignmentOut(BaseModel):
    id: int
    faculty_id: uuid.UUID
    faculty_name: str
    faculty_username: str
    section_id: int
    section_label: str
    subject_id: int
    subject_code: str
    subject_name: str


class StudentSectionIn(BaseModel):
    student_ids: list[uuid.UUID] = Field(min_length=1)
