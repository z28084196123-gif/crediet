import type { AppRole, PromotionStatus, RequirementType, ReviewStatus } from '../lib/types'

export const roleLabel: Record<AppRole, string> = {
  technician: '技師',
  mentor: '督導/組長',
  committee: '教育訓練委員會',
  admin: '管理員',
}

export const reviewStatusLabel: Record<ReviewStatus, string> = {
  pending: '待簽核',
  approved: '已核准',
  rejected: '已退回',
}

export const promotionStatusLabel: Record<PromotionStatus, string> = {
  submitted: '待督導推薦',
  recommended: '待委員會核可',
  approved: '已核可',
  rejected: '未通過',
  withdrawn: '已撤回',
}

export const requirementTypeLabel: Record<RequirementType, string> = {
  practice_hours: '實作時數(小時)',
  course: '完成指定課程',
  quiz_score: '測驗最佳成績(分)',
  case_count: '完工案件數',
  satisfaction_avg: '客戶滿意度平均(1–5)',
  sop_avg: 'SOP 平均分數(1–5)',
}

export const requirementUnit: Record<RequirementType, string> = {
  practice_hours: '小時',
  course: '',
  quiz_score: '分',
  case_count: '件',
  satisfaction_avg: '分',
  sop_avg: '分',
}

export const settingLabel: Record<string, string> = {
  hours_reset_on_promotion: '晉升後時數重新累計',
  promotion_requires_mentor: '晉升需督導推薦',
  sop_scorer_weights: 'SOP 評分者權重',
  scoreboard_period: '計分板預設期間',
}
