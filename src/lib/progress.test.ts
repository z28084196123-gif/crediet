import { describe, expect, it } from 'vitest'
import { gapText, overallPercent, periodRange, requirementPercent } from './progress'
import type { ProgressItem } from './types'

const item = (o: Partial<ProgressItem>): ProgressItem => ({
  requirement_id: 'r', req_type: 'practice_hours', label: '', threshold: 480, current: 120,
  window_days: null, course_id: null, quiz_id: null, met: false, ...o,
})

describe('requirementPercent', () => {
  it('依比例計算並封頂 100', () => {
    expect(requirementPercent(item({}))).toBe(25)
    expect(requirementPercent(item({ current: 999, met: true }))).toBe(100)
  })
  it('課程未完成為 0', () => {
    expect(requirementPercent(item({ req_type: 'course', threshold: 1, current: 0 }))).toBe(0)
  })
})

describe('overallPercent', () => {
  it('平均各條件', () => {
    expect(overallPercent([item({}), item({ met: true, current: 480 })])).toBe(62)
    expect(overallPercent([])).toBe(0)
  })
})

describe('gapText', () => {
  it('時數顯示還差多少', () => {
    expect(gapText(item({}))).toBe('還差 360 小時')
  })
  it('平均類顯示目前與門檻', () => {
    expect(gapText(item({ req_type: 'satisfaction_avg', current: 4.1, threshold: 4.3 }))).toBe('目前 4.1 分,需達 4.3 分')
  })
})

describe('periodRange', () => {
  it('月份', () => {
    expect(periodRange('month', new Date(2026, 1, 15))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('季度', () => {
    expect(periodRange('quarter', new Date(2026, 10, 21))).toMatchObject({ from: '2026-10-01', to: '2026-12-31', label: '2026 年 Q4' })
  })
})

import { toCsv } from './csv'
describe('toCsv', () => {
  it('跳脫逗號與引號並加 BOM', () => {
    expect(toCsv([['a,b', 'say "hi"', null]])).toBe('﻿"a,b","say ""hi""",')
  })
})
