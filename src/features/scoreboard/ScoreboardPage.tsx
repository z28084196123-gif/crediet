import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { isStaffRole, useMe } from '../../lib/auth'
import type { ScoreboardRow } from '../../lib/types'
import { formatNumber, periodRange, shiftPeriod, type PeriodKind } from '../../lib/progress'
import { downloadCsv } from '../../lib/csv'
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, ProgressBar, cx } from '../../components/ui'

function rawText(code: string, raw: number | null) {
  if (raw === null) return '無資料'
  if (code.endsWith('_rate') || code === 'training_completion') return `${formatNumber(raw)}%`
  return `${formatNumber(raw, 2)} 分`
}

function MetricBreakdown({ row }: { row: ScoreboardRow }) {
  return (
    <ul className="space-y-3">
      {row.metrics.items.map((m) => (
        <li key={m.code}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{m.name} <span className="text-xs text-muted">權重 {formatNumber(m.weight)}{!m.higher_is_better && '・越低越好'}</span></span>
            <span className="tabular-nums">{rawText(m.code, m.raw)} → <b>{m.score === null ? '—' : formatNumber(m.score)}</b></span>
          </div>
          <ProgressBar value={m.score ?? 0} />
        </li>
      ))}
    </ul>
  )
}

export default function ScoreboardPage() {
  const me = useMe()
  const staff = isStaffRole(me.role)
  const isTech = me.role === 'technician'
  const [kind, setKind] = useState<PeriodKind>('month')
  const [ref, setRef] = useState(() => new Date())
  const [open, setOpen] = useState<string | null>(null)
  const period = periodRange(kind, ref)

  const board = useQuery({
    queryKey: ['scoreboard', period.from, period.to],
    queryFn: () => unwrap(supabase.rpc('compute_scoreboard', { p_from: period.from, p_to: period.to })) as Promise<ScoreboardRow[]>,
  })

  const snapshot = useMutation({
    mutationFn: () => unwrap(supabase.rpc('create_scoreboard_snapshot', { p_from: period.from, p_to: period.to })) as Promise<number>,
  })

  const rows = [...(board.data ?? [])].sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1))

  function exportCsv() {
    const codes = rows[0]?.metrics.items ?? []
    downloadCsv(`計分板_${period.from}_${period.to}.csv`, [
      ['技師', '職級', '案件數', ...codes.flatMap((m) => [`${m.name}(原始)`, `${m.name}(分數)`]), '總分'],
      ...rows.map((r) => [r.full_name, r.level_name, r.metrics.case_count,
        ...r.metrics.items.flatMap((m) => [m.raw, m.score]), r.total_score]),
    ])
  }

  return (
    <>
      <PageHeader title="績效計分板" subtitle={isTech ? '你的個人績效' : staff ? '全體技師' : '名下技師'}
        action={!isTech && rows.length > 0 && <Button variant="secondary" onClick={exportCsv}>匯出 CSV</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-1 text-sm">
          {(['month', 'quarter'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx('rounded-md px-3 py-1.5', kind === k ? 'bg-brand text-white' : 'text-muted')}>
              {k === 'month' ? '月' : '季'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="上一期" onClick={() => setRef(shiftPeriod(kind, ref, -1))}>‹</Button>
          <span className="min-w-28 text-center text-sm font-medium">{period.label}</span>
          <Button variant="ghost" aria-label="下一期" onClick={() => setRef(shiftPeriod(kind, ref, 1))}>›</Button>
        </div>
        {staff && (
          <Button variant="secondary" className="ml-auto" disabled={snapshot.isPending}
            onClick={() => confirm(`結算 ${period.label} 計分板快照?(供獎金計算使用,可重新結算覆蓋)`) && snapshot.mutate()}>
            結算本期快照
          </Button>
        )}
      </div>
      <ErrorBox error={board.error ?? snapshot.error} />
      {snapshot.isSuccess && <div className="mb-3 rounded-lg bg-ok-soft p-3 text-sm text-ok">已結算 {snapshot.data} 位技師</div>}

      {board.isLoading ? <Loading /> : rows.length === 0 ? <Empty>本期沒有資料</Empty> : isTech ? (
        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <div className="text-sm text-muted">總分・{rows[0].metrics.case_count} 件案件</div>
            <div className="text-4xl font-bold tabular-nums text-brand">{formatNumber(rows[0].total_score)}</div>
          </div>
          <MetricBreakdown row={rows[0]} />
          <Link to="/cases" className="mt-4 block text-center text-sm text-brand">查看我的案件 SOP 評分 →</Link>
        </Card>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.technician_id}>
              <Card className="p-3">
                <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === r.technician_id ? null : r.technician_id)}>
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold', i < 3 ? 'bg-brand text-white' : 'bg-subtle text-muted')}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.full_name}</span>
                    <span className="text-xs text-muted">{r.level_name}・{r.metrics.case_count} 件</span>
                  </span>
                  <span className="text-2xl font-bold tabular-nums">{formatNumber(r.total_score)}</span>
                </button>
                {open === r.technician_id && (
                  <div className="mt-4 border-t border-line pt-4">
                    <MetricBreakdown row={r} />
                    <Link to={`/team/${r.technician_id}`} className="mt-3 inline-block text-sm text-brand">查看晉升進度 →</Link>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted">
        各指標依後台設定的區間換算為 0–100 分,再依權重加權平均;本期沒有資料的指標不列入計算。<Badge>權重可於「設定」調整</Badge>
      </p>
    </>
  )
}
