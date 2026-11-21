import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { nameMap, useVisibleProfiles } from '../../lib/queries'
import type { AuditEntry } from '../../lib/types'
import { Card, Empty, Loading, PageHeader, Select } from '../../components/ui'

const tableLabel: Record<string, string> = {
  career_levels: '職級', level_requirements: '晉升條件', courses: '課程', quizzes: '測驗',
  scoreboard_metrics: '計分指標', sop_nodes: 'SOP 節點', app_settings: '全域設定',
  promotion_requests: '晉升申請', level_history: '職級異動', practice_hours: '實作時數',
  profiles: '人員', mentor_assignments: '督導對應', service_cases: '案件', scoreboard_snapshots: '計分板結算',
}
const actionLabel: Record<string, string> = { insert: '新增', update: '修改', delete: '刪除', snapshot: '結算' }
const IGNORED = new Set(['updated_at', 'created_at'])

function diff(e: AuditEntry): [string, unknown, unknown][] {
  if (e.action !== 'update' || !e.before || !e.after) return []
  return Object.keys(e.after)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(e.before![k]) !== JSON.stringify(e.after![k]))
    .map((k) => [k, e.before![k], e.after![k]])
}
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export default function AuditLogPage() {
  const [table, setTable] = useState('')
  const profiles = useVisibleProfiles()
  const names = nameMap(profiles.data)
  const log = useQuery({
    queryKey: ['audit_log', table],
    queryFn: () => {
      let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200)
      if (table) q = q.eq('table_name', table)
      return unwrap(q.returns<AuditEntry[]>())
    },
  })
  return (
    <>
      <PageHeader title="稽核紀錄" subtitle="最近 200 筆" />
      <Select className="mb-3" value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">全部</option>
        {Object.entries(tableLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      {log.isLoading ? <Loading /> : log.data?.length === 0 ? <Empty>沒有紀錄</Empty> : (
        <ul className="space-y-2">
          {log.data?.map((e) => {
            const changes = diff(e)
            const label = (e.after?.name ?? e.after?.title ?? e.after?.code ?? e.before?.name ?? e.before?.title ?? e.record_id) as string
            return (
              <li key={e.id}>
                <Card className="p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span><b>{e.actor_id ? names[e.actor_id] ?? '使用者' : '系統'}</b> {actionLabel[e.action] ?? e.action}了 {tableLabel[e.table_name] ?? e.table_name}「{label}」</span>
                    <span className="shrink-0 text-xs text-muted">{new Date(e.created_at).toLocaleString('zh-TW')}</span>
                  </div>
                  {changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted">
                      {changes.map(([k, a, b]) => <li key={k} className="break-all">{k}: {show(a)} → <span className="text-ink">{show(b)}</span></li>)}
                    </ul>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
