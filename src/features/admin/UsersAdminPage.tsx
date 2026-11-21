import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useLevels, useVisibleProfiles } from '../../lib/queries'
import type { AppRole, Profile } from '../../lib/types'
import { roleLabel } from '../../i18n/zh-TW'
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select } from '../../components/ui'

interface Assignment { id: string; mentor_id: string; technician_id: string; ends_on: string | null }

function UserRow({ p, mentors, assignment, onChanged }: { p: Profile; mentors: Profile[]; assignment?: Assignment; onChanged: () => void }) {
  const levels = useLevels()
  const [open, setOpen] = useState(false)
  const [d, setD] = useState({ full_name: p.full_name, phone: p.phone ?? '', role: p.role, is_active: p.is_active })
  const [mentor, setMentor] = useState(assignment?.mentor_id ?? '')
  const [level, setLevel] = useState(p.current_level_id ?? '')
  const [reason, setReason] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(supabase.from('profiles').update({ full_name: d.full_name, phone: d.phone || null, role: d.role, is_active: d.is_active }).eq('id', p.id))
      if (mentor !== (assignment?.mentor_id ?? '')) {
        if (assignment) await unwrap(supabase.from('mentor_assignments').update({ ends_on: new Date().toISOString().slice(0, 10) }).eq('id', assignment.id))
        if (mentor) await unwrap(supabase.from('mentor_assignments').insert({ mentor_id: mentor, technician_id: p.id }))
      }
      if (level && level !== p.current_level_id) {
        await unwrap(supabase.rpc('admin_set_level', { p_tech: p.id, p_level: level, p_reason: reason }))
      }
    },
    onSuccess: () => { setReason(''); onChanged() },
  })

  const levelName = levels.data?.find((l) => l.id === p.current_level_id)?.name
  return (
    <Card className="p-3">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
        <span>
          <span className="font-medium">{p.full_name}</span>
          {!p.is_active && <Badge tone="danger">停用</Badge>}
          <span className="ml-2 text-xs text-muted">{roleLabel[p.role]}{levelName && `・${levelName}`}</span>
        </span>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="姓名"><Input value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
            <Field label="電話"><Input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
          </div>
          <Field label="角色">
            <Select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as AppRole })}>
              {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="督導/組長">
            <Select value={mentor} onChange={(e) => setMentor(e.target.value)}>
              <option value="">(無)</option>
              {mentors.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="職級(手動調整)">
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                {levels.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            {level !== (p.current_level_id ?? '') && (
              <Field label="調整原因(必填)"><Input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            )}
          </div>
          <Checkbox label="啟用帳號" checked={d.is_active} onChange={(v) => setD({ ...d, is_active: v })} />
          <ErrorBox error={save.error} />
          <Button className="w-full" disabled={save.isPending || (level !== (p.current_level_id ?? '') && !reason.trim())} onClick={() => save.mutate()}>儲存</Button>
        </div>
      )}
    </Card>
  )
}

export default function UsersAdminPage() {
  const qc = useQueryClient()
  const profiles = useVisibleProfiles()
  const [q, setQ] = useState('')
  const assignments = useQuery({
    queryKey: ['mentor_assignments'],
    queryFn: () => unwrap(supabase.from('mentor_assignments').select('*').is('ends_on', null).returns<Assignment[]>()),
  })
  if (profiles.isLoading || assignments.isLoading) return <Loading />
  const mentors = (profiles.data ?? []).filter((p) => p.role !== 'technician' && p.is_active)
  const list = (profiles.data ?? []).filter((p) => !q || p.full_name.includes(q))
  const changed = () => {
    qc.invalidateQueries({ queryKey: ['profiles'] })
    qc.invalidateQueries({ queryKey: ['mentor_assignments'] })
    qc.invalidateQueries({ queryKey: ['promotion_progress'] })
  }
  return (
    <>
      <PageHeader title="人員與督導" subtitle="新帳號請在 Supabase 後台 Authentication 建立(或用 seed 腳本),登入後會自動出現在這裡" />
      <Input className="mb-3" placeholder="搜尋姓名" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id}>
            <UserRow p={p} mentors={mentors} assignment={assignments.data?.find((a) => a.technician_id === p.id)} onChanged={changed} />
          </li>
        ))}
      </ul>
    </>
  )
}
