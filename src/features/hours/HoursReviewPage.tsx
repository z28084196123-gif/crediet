import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import { nameMap, useVisibleProfiles } from '../../lib/queries'
import type { PracticeHours } from '../../lib/types'
import { formatNumber } from '../../lib/progress'
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader } from '../../components/ui'

export default function HoursReviewPage() {
  const me = useMe()
  const qc = useQueryClient()
  const profiles = useVisibleProfiles()
  const names = nameMap(profiles.data)
  const [notes, setNotes] = useState<Record<string, string>>({})

  // RLS 已限制督導只看到名下技師
  const pending = useQuery({
    queryKey: ['practice_hours', 'pending'],
    queryFn: () => unwrap(supabase.from('practice_hours').select('*').eq('status', 'pending')
      .neq('technician_id', me.id).order('work_date').returns<PracticeHours[]>()),
  })

  const review = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      unwrap(supabase.rpc('review_practice_hours', { p_id: v.id, p_approve: v.approve, p_note: notes[v.id] || null })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['practice_hours'] })
      qc.invalidateQueries({ queryKey: ['promotion_progress'] })
    },
  })

  const approveAll = useMutation({
    mutationFn: async () => {
      for (const h of pending.data ?? []) {
        await unwrap(supabase.rpc('review_practice_hours', { p_id: h.id, p_approve: true, p_note: notes[h.id] || null }))
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['practice_hours'] }),
  })

  return (
    <>
      <PageHeader title="時數簽核" subtitle="名下技師送出的實作時數"
        action={(pending.data?.length ?? 0) > 1 && <Button variant="secondary" disabled={approveAll.isPending} onClick={() => confirm(`全部核准 ${pending.data!.length} 筆?`) && approveAll.mutate()}>全部核准</Button>} />
      <ErrorBox error={review.error ?? approveAll.error} />
      {pending.isLoading ? <Loading /> : pending.data?.length === 0 ? <Empty>目前沒有待簽核的時數 👍</Empty> : (
        <ul className="space-y-3">
          {pending.data?.map((h) => (
            <li key={h.id}>
              <Card>
                <div className="flex justify-between text-sm">
                  <b>{names[h.technician_id] ?? '技師'}</b>
                  <span className="tabular-nums">{h.work_date}・{formatNumber(h.hours)} 小時</span>
                </div>
                <div className="mt-1 text-sm text-muted">{h.description}{h.case_ref && `(工單 ${h.case_ref})`}</div>
                <Input className="mt-3" placeholder="備註(選填)" value={notes[h.id] ?? ''} onChange={(e) => setNotes({ ...notes, [h.id]: e.target.value })} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate({ id: h.id, approve: false })}>退回</Button>
                  <Button disabled={review.isPending} onClick={() => review.mutate({ id: h.id, approve: true })}>核准</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
