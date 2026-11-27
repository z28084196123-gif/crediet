import { ask } from '../../lib/confirm'
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import type { PracticeHours } from '../../lib/types'
import { reviewStatusLabel } from '../../i18n/zh-TW'
import { formatNumber } from '../../lib/progress'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, PageHeader, Stat, Textarea } from '../../components/ui'

const today = () => new Date().toISOString().slice(0, 10)

export default function MyHoursPage() {
  const me = useMe()
  const qc = useQueryClient()
  const [form, setForm] = useState({ work_date: today(), hours: '', case_ref: '', description: '' })

  const list = useQuery({
    queryKey: ['practice_hours', me.id],
    queryFn: () => unwrap(supabase.from('practice_hours').select('*').eq('technician_id', me.id)
      .order('work_date', { ascending: false }).order('created_at', { ascending: false }).returns<PracticeHours[]>()),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['practice_hours'] })
    qc.invalidateQueries({ queryKey: ['promotion_progress'] })
  }

  const add = useMutation({
    mutationFn: () => unwrap(supabase.from('practice_hours').insert({
      work_date: form.work_date,
      hours: Number(form.hours),
      case_ref: form.case_ref || null,
      description: form.description,
    })),
    onSuccess: () => { setForm({ work_date: today(), hours: '', case_ref: '', description: '' }); invalidate() },
  })

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(supabase.from('practice_hours').delete().eq('id', id)),
    onSuccess: invalidate,
  })

  const sum = (s: PracticeHours['status']) => (list.data ?? []).filter((h) => h.status === s).reduce((a, h) => a + Number(h.hours), 0)

  return (
    <>
      <PageHeader title="實作時數" subtitle="登錄跟車/實作時數,經督導簽核後才會計入晉升條件" />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="已核准(計入)" value={formatNumber(sum('approved'))} hint="小時" />
        <Stat label="待簽核" value={formatNumber(sum('pending'))} hint="小時" />
      </div>

      <Card className="mb-4">
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate() }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期"><Input type="date" required max={today()} value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} /></Field>
            <Field label="時數"><Input type="number" inputMode="decimal" step="0.5" min="0.5" max="24" required value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></Field>
          </div>
          <Field label="工單號(選填)"><Input value={form.case_ref} onChange={(e) => setForm({ ...form, case_ref: e.target.value })} /></Field>
          <Field label="實作內容"><Textarea required placeholder="例:跟車處理廚房排水堵塞,協助內視鏡檢測" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <ErrorBox error={add.error} />
          <Button type="submit" className="w-full" disabled={add.isPending}>送出,等待督導簽核</Button>
        </form>
      </Card>

      {list.isLoading ? <Loading /> : list.data?.length === 0 ? <Empty>還沒有時數紀錄</Empty> : (
        <ul className="space-y-2">
          {list.data?.map((h) => (
            <li key={h.id}>
              <Card className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{h.work_date}・{formatNumber(h.hours)} 小時{h.case_ref && <span className="text-muted">・{h.case_ref}</span>}</div>
                  <Badge tone={h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'danger' : 'warn'}>{reviewStatusLabel[h.status]}</Badge>
                </div>
                <div className="mt-1 text-sm text-muted">{h.description}</div>
                {h.review_note && <div className="mt-1 text-xs text-muted">督導備註:{h.review_note}</div>}
                {h.status === 'pending' && (
                  <button className="mt-1 text-xs text-danger" onClick={() => ask('確定刪除這筆紀錄?') && remove.mutate(h.id)}>刪除</button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
