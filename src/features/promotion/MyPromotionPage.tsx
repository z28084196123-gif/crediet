import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import { useLevels, usePromotionProgress } from '../../lib/queries'
import type { PromotionRequest } from '../../lib/types'
import { Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, Textarea } from '../../components/ui'
import PromotionCard from './PromotionCard'

export default function MyPromotionPage() {
  const me = useMe()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const levels = useLevels()
  const prog = usePromotionProgress(me.id)
  const reqs = useQuery({
    queryKey: ['promotion_requests', me.id],
    queryFn: () => unwrap(supabase.from('promotion_requests').select('*').eq('technician_id', me.id)
      .order('created_at', { ascending: false }).returns<PromotionRequest[]>()),
  })
  const levelName = (id: string | null) => levels.data?.find((l) => l.id === id)?.name ?? '—'
  const refresh = () => qc.invalidateQueries({ queryKey: ['promotion_requests'] })

  const submit = useMutation({
    mutationFn: () => unwrap(supabase.rpc('submit_promotion_request', { p_note: note || null })),
    onSuccess: () => { setNote(''); refresh() },
  })
  const withdraw = useMutation({
    mutationFn: (id: string) => unwrap(supabase.rpc('withdraw_promotion_request', { p_id: id })),
    onSuccess: refresh,
  })

  if (prog.isLoading || reqs.isLoading) return <Loading />
  const open = reqs.data?.find((r) => r.status === 'submitted' || r.status === 'recommended')
  const p = prog.data

  return (
    <>
      <PageHeader title="晉升申請" subtitle="達標後送出 → 督導推薦 → 教育訓練委員會核可" />
      {!open && p && !p.is_top_level && (
        <Card className="mb-4">
          {p.eligible ? (
            <div className="space-y-3">
              <div className="font-medium">你已達成晉升「{p.next_level?.name}」的所有條件 🎉</div>
              <Field label="補充說明(選填)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="例:近期處理過的代表性案件" /></Field>
              <ErrorBox error={submit.error} />
              <Button className="w-full" disabled={submit.isPending} onClick={() => submit.mutate()}>送出晉升申請</Button>
            </div>
          ) : (
            <div className="text-sm">
              尚未達成晉升「{p.next_level?.name}」的條件。<Link to="/me" className="text-brand">查看還差什麼 →</Link>
            </div>
          )}
        </Card>
      )}
      <ErrorBox error={withdraw.error} />
      {reqs.data?.length === 0 ? <Empty>還沒有晉升申請紀錄</Empty> : (
        <ul className="space-y-3">
          {reqs.data?.map((r) => (
            <li key={r.id}>
              <PromotionCard req={r} levelName={levelName}>
                {(r.status === 'submitted' || r.status === 'recommended') && (
                  <Button variant="ghost" className="mt-2 px-0" onClick={() => confirm('確定撤回申請?') && withdraw.mutate(r.id)}>撤回申請</Button>
                )}
              </PromotionCard>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
