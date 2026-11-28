import { ask } from '../../lib/confirm'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useCourses, useLevels, useQuizzes, useScenarios } from '../../lib/queries'
import type { CareerLevel, LevelRequirement, RequirementType } from '../../lib/types'
import { requirementTypeLabel } from '../../i18n/zh-TW'
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select } from '../../components/ui'

type ReqDraft = Omit<LevelRequirement, 'id'> & { id?: string }

function RequirementRow({ r, onSave, onDelete, busy }: { r: ReqDraft; onSave: (r: ReqDraft) => void; onDelete?: () => void; busy: boolean }) {
  const [d, setD] = useState<ReqDraft>(r)
  const courses = useCourses(true)
  const quizzes = useQuizzes()
  const scenarios = useScenarios(true)
  const dirty = JSON.stringify(d) !== JSON.stringify(r)
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="條件類型">
          <Select value={d.req_type} onChange={(e) => setD({ ...d, req_type: e.target.value as RequirementType, course_id: null, quiz_id: null, scenario_id: null })}>
            {Object.entries(requirementTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {d.req_type === 'course' ? (
          <Field label="課程">
            <Select value={d.course_id ?? ''} onChange={(e) => setD({ ...d, course_id: e.target.value || null, threshold: 1 })}>
              <option value="">請選擇</option>
              {courses.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="門檻"><Input type="number" step="any" value={d.threshold} onChange={(e) => setD({ ...d, threshold: Number(e.target.value) })} /></Field>
        )}
      </div>
      {d.req_type === 'scenario' && (
        <Field label="情境劇">
          <Select value={d.scenario_id ?? ''} onChange={(e) => setD({ ...d, scenario_id: e.target.value || null })}>
            <option value="">請選擇</option>
            {scenarios.data?.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </Select>
        </Field>
      )}
      {d.req_type === 'quiz_score' && (
        <Field label="測驗">
          <Select value={d.quiz_id ?? ''} onChange={(e) => setD({ ...d, quiz_id: e.target.value || null })}>
            <option value="">請選擇</option>
            {quizzes.data?.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="統計區間(天)" hint="空白 = 累計全部">
          <Input type="number" min={1} value={d.window_days ?? ''} onChange={(e) => setD({ ...d, window_days: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="顯示名稱" hint="空白 = 自動">
          <Input value={d.label ?? ''} onChange={(e) => setD({ ...d, label: e.target.value || null })} />
        </Field>
      </div>
      <div className="flex items-center justify-between">
        <Checkbox label="啟用" checked={d.is_active} onChange={(v) => setD({ ...d, is_active: v })} />
        <div className="flex gap-2">
          {onDelete && <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => ask('刪除此條件?') && onDelete()}>刪除</Button>}
          <Button disabled={!dirty || busy} onClick={() => onSave(d)}>{r.id ? '儲存' : '新增'}</Button>
        </div>
      </div>
    </div>
  )
}

function LevelCard({ level, reqs }: { level: CareerLevel; reqs: LevelRequirement[] }) {
  const qc = useQueryClient()
  const [d, setD] = useState(level)
  const [adding, setAdding] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['career_levels'] })
    qc.invalidateQueries({ queryKey: ['level_requirements'] })
    qc.invalidateQueries({ queryKey: ['promotion_progress'] })
  }
  const saveLevel = useMutation({
    mutationFn: () => unwrap(supabase.from('career_levels').update({ name: d.name, description: d.description, is_active: d.is_active }).eq('id', level.id)),
    onSuccess: refresh,
  })
  const saveReq = useMutation({
    mutationFn: (r: ReqDraft) => {
      const { id } = r
      const rest = {
        level_id: r.level_id, req_type: r.req_type, threshold: r.threshold,
        course_id: r.req_type === 'course' ? r.course_id : null,
        quiz_id: r.req_type === 'quiz_score' ? r.quiz_id : null,
        scenario_id: r.req_type === 'scenario' ? r.scenario_id : null,
        window_days: r.window_days, label: r.label, sort_order: r.sort_order, is_active: r.is_active,
      }
      return id ? unwrap(supabase.from('level_requirements').update(rest).eq('id', id))
                : unwrap(supabase.from('level_requirements').insert(rest))
    },
    onSuccess: () => { setAdding(false); refresh() },
  })
  const delReq = useMutation({
    mutationFn: (id: string) => unwrap(supabase.from('level_requirements').delete().eq('id', id)),
    onSuccess: refresh,
  })
  const busy = saveReq.isPending || delReq.isPending

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Badge tone="brand">第 {level.rank} 級</Badge>
        <span className="text-xs text-muted">代碼 {level.code}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Field label="名稱"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="說明"><Input value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Checkbox label="啟用" checked={d.is_active} onChange={(v) => setD({ ...d, is_active: v })} />
        <Button variant="secondary" disabled={JSON.stringify(d) === JSON.stringify(level) || saveLevel.isPending} onClick={() => saveLevel.mutate()}>儲存職級</Button>
      </div>
      <ErrorBox error={saveLevel.error ?? saveReq.error ?? delReq.error} />

      {level.rank > 1 && (
        <div className="mt-4 space-y-2">
          <div className="text-sm font-medium">晉升到「{level.name}」需要的條件</div>
          {reqs.map((r) => (
            <RequirementRow key={r.id + r.threshold + r.is_active} r={r} busy={busy} onSave={(x) => saveReq.mutate(x)} onDelete={() => delReq.mutate(r.id)} />
          ))}
          {adding ? (
            <RequirementRow busy={busy} onSave={(x) => saveReq.mutate(x)}
              r={{ level_id: level.id, req_type: 'practice_hours', threshold: 100, course_id: null, quiz_id: null, scenario_id: null, window_days: null, label: null, sort_order: reqs.length + 1, is_active: true }} />
          ) : (
            <Button variant="ghost" onClick={() => setAdding(true)}>＋ 新增條件</Button>
          )}
        </div>
      )}
      {level.rank === 1 && <p className="mt-3 text-xs text-muted">新進人員預設為此職級,不需晉升條件。</p>}
    </Card>
  )
}

export default function LevelsAdminPage() {
  const levels = useLevels()
  const reqs = useQuery({
    queryKey: ['level_requirements'],
    queryFn: () => unwrap(supabase.from('level_requirements').select('*').order('sort_order').order('created_at').returns<LevelRequirement[]>()),
  })
  if (levels.isLoading || reqs.isLoading) return <Loading />
  return (
    <>
      <PageHeader title="職級與晉升條件" subtitle="預設門檻為草案(非 Mr. Rooter 官方數字),請依公司制度調整" />
      <div className="space-y-4">
        {levels.data?.map((l) => (
          <LevelCard key={l.id + l.name + l.is_active} level={l} reqs={(reqs.data ?? []).filter((r) => r.level_id === l.id)} />
        ))}
      </div>
    </>
  )
}
