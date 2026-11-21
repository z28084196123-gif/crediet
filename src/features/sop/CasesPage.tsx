import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { canManageRole, useMe } from '../../lib/auth'
import { nameMap, useSopNodes, useVisibleProfiles } from '../../lib/queries'
import type { ServiceCase } from '../../lib/types'
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, PageHeader, Select } from '../../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = { technician_id: '', external_ref: '', completed_on: today(), quoted: true, converted: false, is_callback: false, satisfaction: '' }

export default function CasesPage() {
  const me = useMe()
  const manage = canManageRole(me.role)
  const qc = useQueryClient()
  const profiles = useVisibleProfiles()
  const names = nameMap(profiles.data)
  const techs = (profiles.data ?? []).filter((p) => p.id !== me.id && (p.role === 'technician' || p.role === 'mentor'))
  const nodes = useSopNodes()
  const [filter, setFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const cases = useQuery({
    queryKey: ['service_cases', filter],
    queryFn: () => {
      let q = supabase.from('service_cases').select('*, sop_scores(node_id)').order('completed_on', { ascending: false }).limit(100)
      if (filter) q = q.eq('technician_id', filter)
      return unwrap(q.returns<(ServiceCase & { sop_scores: { node_id: string }[] })[]>())
    },
  })

  const create = useMutation({
    mutationFn: () => unwrap(supabase.from('service_cases').insert({
      technician_id: form.technician_id,
      external_ref: form.external_ref || null,
      completed_on: form.completed_on,
      quoted: form.quoted,
      converted: form.quoted && form.converted,
      is_callback: form.is_callback,
      satisfaction: form.satisfaction ? Number(form.satisfaction) : null,
    }).select('id').single<{ id: string }>()),
    onSuccess: () => {
      setForm(emptyForm)
      setShowForm(false)
      qc.invalidateQueries({ queryKey: ['service_cases'] })
    },
  })

  const nodeCount = nodes.data?.length ?? 0

  return (
    <>
      <PageHeader title={manage ? '案件與 SOP 評分' : '我的案件評分'}
        subtitle="每案依五個 SOP 節點(到府、診斷、報價、施工、收款簽收)評分"
        action={manage && <Button onClick={() => setShowForm(!showForm)}>{showForm ? '取消' : '＋ 新增案件'}</Button>} />

      {showForm && (
        <Card className="mb-4">
          <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate() }}>
            <Field label="技師">
              <Select required value={form.technician_id} onChange={(e) => setForm({ ...form, technician_id: e.target.value })}>
                <option value="">請選擇</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="工單號"><Input value={form.external_ref} onChange={(e) => setForm({ ...form, external_ref: e.target.value })} /></Field>
              <Field label="完工日"><Input type="date" required value={form.completed_on} onChange={(e) => setForm({ ...form, completed_on: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Checkbox label="有報價" checked={form.quoted} onChange={(v) => setForm({ ...form, quoted: v })} />
              <Checkbox label="已成交" checked={form.converted} onChange={(v) => setForm({ ...form, converted: v })} />
              <Checkbox label="回修案" checked={form.is_callback} onChange={(v) => setForm({ ...form, is_callback: v })} />
            </div>
            <Field label="客戶滿意度(1–5,選填)">
              <Select value={form.satisfaction} onChange={(e) => setForm({ ...form, satisfaction: e.target.value })}>
                <option value="">未填</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} 分</option>)}
              </Select>
            </Field>
            <ErrorBox error={create.error} />
            <Button type="submit" className="w-full" disabled={create.isPending}>建立案件</Button>
          </form>
        </Card>
      )}

      {manage && techs.length > 0 && (
        <Select className="mb-3" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">全部技師</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </Select>
      )}

      {cases.isLoading ? <Loading /> : cases.data?.length === 0 ? <Empty>沒有案件</Empty> : (
        <ul className="space-y-2">
          {cases.data?.map((c) => {
            const scored = new Set(c.sop_scores.map((s) => s.node_id)).size
            return (
              <li key={c.id}>
                <Link to={`/cases/${c.id}`}>
                  <Card className="p-3 transition hover:border-brand">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{c.external_ref ?? '(無工單號)'}・{names[c.technician_id] ?? ''}</div>
                      <Badge tone={scored >= nodeCount && nodeCount > 0 ? 'ok' : 'warn'}>SOP {scored}/{nodeCount}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                      <span>{c.completed_on}</span>
                      {c.quoted && <Badge>{c.converted ? '已成交' : '未成交'}</Badge>}
                      {c.is_callback && <Badge tone="danger">回修</Badge>}
                      {c.satisfaction && <Badge tone="brand">滿意度 {c.satisfaction}</Badge>}
                      {c.source !== 'manual' && <Badge>{c.source}</Badge>}
                    </div>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
