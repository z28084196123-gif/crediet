import type { ProgressItem } from './types'
import { requirementUnit } from '../i18n/zh-TW'

/** 單一條件的完成百分比(0–100) */
export function requirementPercent(item: Pick<ProgressItem, 'req_type' | 'current' | 'threshold' | 'met'>): number {
  if (item.met) return 100
  if (item.req_type === 'course') return 0
  if (item.threshold <= 0) return 100
  return Math.max(0, Math.min(100, Math.floor((Number(item.current) / Number(item.threshold)) * 100)))
}

/** 整體完成度:各條件百分比平均 */
export function overallPercent(items: ProgressItem[]): number {
  if (items.length === 0) return 0
  return Math.floor(items.reduce((s, i) => s + requirementPercent(i), 0) / items.length)
}

export function formatNumber(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? v.toLocaleString('zh-TW') : v.toLocaleString('zh-TW', { maximumFractionDigits: digits })
}

/** 「下一級還差什麼」的文字 */
export function gapText(item: ProgressItem): string {
  if (item.met) return '已達成'
  if (item.req_type === 'course') return '尚未完成課程'
  const unit = requirementUnit[item.req_type]
  if (item.req_type === 'satisfaction_avg' || item.req_type === 'sop_avg' || item.req_type === 'quiz_score') {
    return `目前 ${formatNumber(item.current, 2)} ${unit},需達 ${formatNumber(item.threshold, 2)} ${unit}`
  }
  const diff = Number(item.threshold) - Number(item.current)
  return `還差 ${formatNumber(diff, 2)} ${unit}`
}

export type PeriodKind = 'month' | 'quarter'

function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 期間起訖(含當日所在月份/季度) */
export function periodRange(kind: PeriodKind, ref: Date = new Date()): { from: string; to: string; label: string } {
  const y = ref.getFullYear()
  if (kind === 'quarter') {
    const q = Math.floor(ref.getMonth() / 3)
    return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)), label: `${y} 年 Q${q + 1}` }
  }
  const m = ref.getMonth()
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), label: `${y} 年 ${m + 1} 月` }
}

export function shiftPeriod(kind: PeriodKind, ref: Date, delta: number): Date {
  return new Date(ref.getFullYear(), ref.getMonth() + delta * (kind === 'quarter' ? 3 : 1), 1)
}
