export type Role = 'admin' | 'faculty' | 'student' | 'club';

export interface Me {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: Role;
  department_code: string | null;
  must_change_password: boolean;
  google_linked: boolean;
}

export interface AuthConfig {
  google_client_id: string | null;
  password_login: boolean;
  password_reset_email: boolean;
  /** Development only: the API signs in DEV_AUTO_LOGIN_EMAIL automatically. */
  dev_auto_login: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: Me;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface User {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: Role;
  department_id: number | null;
  is_active: boolean;
  must_change_password: boolean;
  google_linked: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface Department {
  id: number;
  code: string;
  name: string;
}

export interface Section {
  id: number;
  department_id: number;
  department_code: string | null;
  semester: number;
  name: string;
  academic_year: string;
  student_count: number;
}

export interface Subject {
  id: number;
  code: string;
  name: string;
  department_id: number | null;
  semester: number | null;
}

export interface Assignment {
  id: number;
  faculty_id: string;
  faculty_name: string;
  faculty_username: string;
  section_id: number;
  section_label: string;
  subject_id: number;
  subject_code: string;
  subject_name: string;
}

export type ImportKind = 'students' | 'faculty' | 'mapping';
export type ImportStatus = 'uploaded' | 'parsing' | 'preview' | 'committing' | 'done' | 'failed';

export interface ImportRowError {
  row: number;
  errors: string[];
  values: Record<string, unknown>;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  status: ImportStatus;
  original_filename: string;
  academic_year: string;
  header_map: Record<string, string> | null;
  source_headers: string[] | null;
  preview_rows: Record<string, unknown>[] | null;
  error_rows: ImportRowError[] | null;
  total_rows: number;
  valid_rows: number;
  created_count: number;
  updated_count: number;
  message: string | null;
  has_credentials: boolean;
  created_at: string;
}

export interface ImportFields {
  kind: ImportKind;
  required: string[];
  optional: string[];
}

export interface IntegrityEvent {
  id: number;
  user_id: string;
  username: string;
  full_name: string;
  session_id: string;
  attempt_id: string | null;
  kind: string;
  client_at: string;
  received_at: string;
  meta: Record<string, unknown> | null;
}

export interface TraceResult {
  found: boolean;
  short_code?: string;
  session_id?: string;
  user_id?: string;
  username?: string;
  full_name?: string;
  role?: string;
  session_started_at?: string;
  user_agent?: string;
  incident_count: number;
}

export interface GuardSession {
  session_id: string;
  short_code: string;
  label: string;
}

// ---------------------------------------------------------------- activities

export type ActivityKind = 'quiz' | 'assignment' | 'poll' | 'flashcards';
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'multi_select' | 'justify' | 'open_ended';

export interface QOption {
  id?: string | null;
  text: string;
  image_id?: string | null;
  correct?: boolean;
}

export interface QuestionData {
  type: QuestionType;
  stem: string;
  stem_image_id?: string | null;
  options: QOption[];
  answer: Record<string, unknown>;
  marks: string | number;
  partial_credit: boolean;
  explanation?: string | null;
  tags: string[];
  time_limit_seconds?: number | null;
  rubric: RubricItem[];
}

export interface RubricItem {
  id?: string | null;
  criterion: string;
  max: number | string;
}

export interface Question extends QuestionData {
  id: string;
  position: number;
}

export interface ActivitySummary {
  id: string;
  title: string;
  description: string | null;
  kind: ActivityKind;
  status: 'draft' | 'published' | 'archived';
  subject_id: number | null;
  department_id: number | null;
  section_ids: number[];
  semesters: number[];
  class_labels: string[];
  time_limit_seconds: number | null;
  question_count: number;
  total_marks: string;
  assignment_count: number;
  created_at: string;
  updated_at: string;
}

export interface Activity extends ActivitySummary {
  questions: Question[];
}

export interface AssignmentInfo {
  id: string;
  activity_id: string;
  activity_title: string;
  activity_kind: ActivityKind;
  start_at: string;
  due_at: string | null;
  allow_late: boolean;
  max_attempts: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  instant_feedback: boolean;
  show_answers: 'never' | 'after_submit' | 'after_due';
  release_mode: 'immediate' | 'after_due' | 'manual';
  released_at: string | null;
  time_limit_seconds: number | null;
  max_violations: number;
  require_fullscreen: boolean;
  notify: boolean;
  is_room: boolean;
  join_code: string | null;
  accepting_joins: boolean;
  host_name: string | null;
  section_ids: number[];
  student_ids: string[];
  target_labels: string[];
  student_count: number;
  submitted_count: number;
  created_at: string;
}

export interface MyActivity {
  assignment_id: string;
  title: string;
  kind: ActivityKind;
  question_count: number;
  start_at: string;
  due_at: string | null;
  allow_late: boolean;
  time_limit_seconds: number | null;
  attempts_used: number;
  attempts_left: number | null;
  in_progress_attempt_id: string | null;
  can_start: boolean;
  window: string;
  best_attempt_id: string | null;
  score: string | null;
  max_score: string | null;
  pending_grading: boolean;
  submitted_at: string | null;
  missed?: boolean;
}

export interface AttemptState {
  attempt_id: string;
  assignment_id: string;
  activity_title: string;
  activity_kind: ActivityKind;
  status: 'in_progress' | 'submitted';
  submit_reason: string | null;
  total: number;
  current_index: number;
  answered: number[];
  linear: boolean;
  instant_feedback: boolean;
  started_at: string;
  deadline_at: string | null;
  server_now: string;
  violations: number;
  max_violations: number;
  require_fullscreen: boolean;
  attempt_no: number;
}

export interface Feedback {
  correct: boolean | null;
  score: string | null;
  marks: string;
  key: { choices?: string[]; blanks?: string[] };
  explanation: string | null;
}

export interface PlayQuestion {
  index: number;
  total: number;
  question: {
    id: string;
    type: QuestionType;
    stem: string;
    stem_image_id: string | null;
    options: { id: string; text: string; image_id: string | null }[];
    marks: string;
    time_limit_seconds: number | null;
    blank_count?: number;
    select_count?: number;
    back?: string | null;
  };
  response: Record<string, unknown> | null;
  locked: boolean;
  question_deadline: string | null;
  server_now: string;
  feedback: Feedback | null;
}

export interface ReviewItem {
  index: number;
  question: PlayQuestion['question'];
  response: Record<string, unknown> | null;
  marks: string;
  score?: string | null;
  pending?: boolean;
  feedback?: string | null;
  correct?: boolean | null;
  key?: { choices?: string[]; blanks?: string[] };
  explanation?: string | null;
  rubric?: (RubricItem & { score: string | null })[];
}

export interface Review {
  attempt_id: string;
  status: string;
  submit_reason: string | null;
  submitted_at: string | null;
  scores_visible: boolean;
  answers_visible: boolean;
  score: string | null;
  max_score: string;
  needs_manual: boolean;
  violations: number;
  items: ReviewItem[];
}

export interface ReportStudent {
  student_id: string;
  name: string;
  usn: string;
  email: string | null;
  status: 'submitted' | 'in_progress' | 'not_started';
  attempts: number;
  attempt_id: string | null;
  score: string | null;
  max_score: string | null;
  accuracy: number | null;
  needs_manual: boolean;
  violations: number;
  submit_reason: string | null;
  late: boolean;
  submitted_at: string | null;
  /** Set when the latest attempt was auto-submitted for too many warnings. */
  blocked_attempt_id: string | null;
  unblocked: number;
  /** Overview grid: question id -> correct | partial | wrong | pending | blank | answered */
  cells?: Record<string, string>;
}

export interface ReportQuestion {
  question_id: string;
  position: number;
  type: QuestionType;
  stem: string;
  marks: string;
  answered: number;
  correct: number;
  pending: number;
  accuracy: number | null;
  avg_score: string | null;
  options: { id: string; text: string; count: number }[];
}

export interface Report {
  assignment: AssignmentInfo;
  summary: {
    assigned: number;
    started: number;
    submitted: number;
    completion: number;
    avg_accuracy: number | null;
    avg_score: string | null;
    high_score: string | null;
    low_score: string | null;
    max_score: string;
    pending_grading: number;
    graded: boolean;
  };
  questions: ReportQuestion[];
  students: ReportStudent[];
}

export interface GradingItem {
  attempt_id: string;
  question_id: string;
  student: string;
  usn: string;
  type: QuestionType;
  stem: string;
  options: { id: string; text: string; correct?: boolean }[];
  response: Record<string, unknown> | null;
  marks: string;
  choice_correct: boolean | null;
  explanation: string | null;
  rubric: RubricItem[];
}

export interface StudentBrief {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
}

export interface TeachingClass {
  section_id: number;
  department_id: number;
  department_code: string | null;
  semester: number;
  section: string;
  academic_year: string;
  label: string;
  subjects: { id: number; code: string; name: string }[];
}

export interface MyClasses {
  department: { id: number; code: string; name: string } | null;
  /** Branches (departments) where the teacher has classes. */
  branches: { id: number; code: string; name: string }[];
  department_locked: boolean;
  can_use_sections: boolean;
  classes: TeachingClass[];
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actor_id: string | null;
  actor: string | null;
  target: string | null;
  meta: Record<string, unknown> | null;
}

export interface RoomPreview {
  assignment_id: string;
  title: string;
  kind: ActivityKind;
  host: string | null;
  question_count: number;
  time_limit_seconds: number | null;
  due_at: string | null;
  open: boolean;
  joined: boolean;
}
