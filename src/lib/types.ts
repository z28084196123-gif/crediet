export type AppRole = 'technician' | 'mentor' | 'committee' | 'admin'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type PromotionStatus = 'submitted' | 'recommended' | 'approved' | 'rejected' | 'withdrawn'
export type RequirementType =
  | 'practice_hours'
  | 'course'
  | 'quiz_score'
  | 'case_count'
  | 'satisfaction_avg'
  | 'sop_avg'
export type UnitType = 'text' | 'video' | 'image'

export interface CareerLevel {
  id: string
  code: string
  name: string
  rank: number
  description: string | null
  is_active: boolean
}

export interface Profile {
  id: string
  full_name: string
  phone: string | null
  role: AppRole
  current_level_id: string | null
  hired_on: string | null
  is_active: boolean
}

export interface ProgressItem {
  requirement_id: string
  req_type: RequirementType
  label: string
  threshold: number
  current: number
  window_days: number | null
  course_id: string | null
  quiz_id: string | null
  met: boolean
}

export interface PromotionProgress {
  current_level: CareerLevel | null
  next_level: CareerLevel | null
  requirements: ProgressItem[]
  eligible: boolean
  is_top_level: boolean
}

export interface PracticeHours {
  id: string
  technician_id: string
  work_date: string
  hours: number
  case_ref: string | null
  description: string
  status: ReviewStatus
  reviewer_id: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}

export interface Course {
  id: string
  title: string
  description: string | null
  category: string | null
  sort_order: number
  is_active: boolean
}

export interface CourseUnit {
  id: string
  course_id: string
  title: string
  unit_type: UnitType
  body: string | null
  media_url: string | null
  sort_order: number
}

export interface Quiz {
  id: string
  course_id: string
  title: string
  pass_score: number
  max_attempts: number | null
  reveal_answers: boolean
  is_active: boolean
}

export interface QuizQuestion {
  id: string
  quiz_id: string
  prompt: string
  options: string[]
  sort_order: number
}

export interface QuizResult {
  score: number
  passed: boolean
  pass_score: number
  correct: number
  total: number
  results: { question_id: string; correct: boolean; correct_index?: number; explanation?: string | null }[]
}

export interface LevelRequirement {
  id: string
  level_id: string
  req_type: RequirementType
  threshold: number
  course_id: string | null
  quiz_id: string | null
  window_days: number | null
  label: string | null
  sort_order: number
  is_active: boolean
}

export interface PromotionRequest {
  id: string
  technician_id: string
  from_level_id: string | null
  to_level_id: string
  status: PromotionStatus
  progress_snapshot: PromotionProgress
  technician_note: string | null
  mentor_id: string | null
  mentor_comment: string | null
  mentor_at: string | null
  decided_by: string | null
  decision_comment: string | null
  decided_at: string | null
  created_at: string
}

export interface ServiceCase {
  id: string
  source: string
  external_ref: string | null
  technician_id: string
  completed_on: string
  quoted: boolean
  converted: boolean
  is_callback: boolean
  satisfaction: number | null
  notes: string | null
  created_at: string
}

export interface SopNode {
  id: string
  code: string
  name: string
  description: string | null
  criteria: string[]
  weight: number
  sort_order: number
  is_active: boolean
}

export interface SopScore {
  id: string
  case_id: string
  node_id: string
  technician_id: string
  scorer_id: string | null
  scorer_type: 'mentor' | 'customer'
  score: number
  comment: string | null
}

export interface ScoreboardMetric {
  id: string
  code: string
  name: string
  description: string | null
  weight: number
  higher_is_better: boolean
  norm_min: number
  norm_max: number
  sort_order: number
  is_active: boolean
}

export interface ScoreboardMetricValue {
  code: string
  name: string
  raw: number | null
  score: number | null
  weight: number
  higher_is_better: boolean
}

export interface ScoreboardRow {
  technician_id: string
  full_name: string
  level_name: string | null
  metrics: { items: ScoreboardMetricValue[]; case_count: number }
  total_score: number | null
}

export interface AppSetting {
  key: string
  value: unknown
  description: string | null
}

export interface AuditEntry {
  id: number
  actor_id: string | null
  action: string
  table_name: string
  record_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}
