import { ask } from '../../lib/confirm'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap, unwrapMaybe } from '../../lib/supabase'
import { isStaffRole, useMe } from '../../lib/auth'
import { nameMap, useLevels, useVisibleProfiles } from '../../lib/queries'
import type { PromotionRequest } from '../../lib/types'
import { Button, Empty, ErrorBox, Input, Loading, PageHeader, cx } from '../../components/ui'
import PromotionCard from './PromotionCard'

export default function PromotionQueuePage() {
  const me = useMe()
  const staff = isStaffRole(me.role)
  const qc = useQueryClient()
  const [tab, setTab] = useState<'todo' | 'all'>('todo')
  const [comments, setComments] = useState<Record<string, string>>({})
  const levels = useLevels()
  const profiles = useVisibleProfiles()
  const names = nameMap(profiles.data)
  const levelName = (id: string | null) => levels.data?.find((l) => l.id === id)?.name ?? '—'

  const settings = useQuery({
    queryKey: ['app_settings', 'promotion_requires_mentor'],
    queryFn: () => unwrapMaybe(supabase.from('app_settings').select('value').eq('key', 'promotion_requires_mentor').maybeSingle<{ value: boolean }>()),
  })
  const needsMentor = settings.data?.value !== false

  const reqs = useQuery({
    queryKey: ['promotion_requests', 'queue'],
    queryFn: () => unwrap(supabase.from('promotion_requests').select('*').neq('technician_id', me.id)
      .order('created_at', { ascending: false }).returns<PromotionRequest[]>()),
  })

  // 督導處理 submitted;委員會處理 recommended(若設定不需督導推薦,submitted 也可直接核可)
  const isTodo = (r: PromotionRequest) =>
    staff ? r.status === 'recommended' || (r.status === 'submitted' && !needsMentor)
          : r.status === 'submitted'

  const act = useMutation({
    mutationFn: ({ r, ok }: { r: PromotionRequest; ok: boolean }) => {
      const comment = comments[r.id] || null
      return !staff
        ? unwrap(supabase.rpc('recommend_promotion', { p_id: r.id, p_recommend: ok, p_comment: comment }))
        : unwrap(supabase.rpc('decide_promotion', { p_id: r.id, p_approve: ok, p_comment: comment }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotion_requests'] })
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['promotion_progress'] })
    },
  })

  if (reqs.isLoading) return <Loading />
  const list = (reqs.data ?? []).filter((r) => (tab === 'todo' ? isTodo(r) : true))

  return (
    <>
      <PageHeader title={staff ? '晉升核可' : '晉升推薦'}
        subtitle={staff ? '督導已推薦的申請,核可後技師職級立即更新並留下歷程' : '名下技師的晉升申請,推薦後送教育訓練委員會'} />
      <div className="mb-4 inline-flex rounded-lg border border-line p-1 text-sm">
        {(['todo', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1.5', tab === t ? 'bg-brand text-white' : 'text-muted')}>
            {t === 'todo' ? `待處理 (${(reqs.data ?? []).filter(isTodo).length})` : '全部'}
          </button>
        ))}
      </div>
      <ErrorBox error={act.error} />
      {list.length === 0 ? <Empty>{tab === 'todo' ? '目前沒有待處理的申請' : '沒有申請紀錄'}</Empty> : (
        <ul className="space-y-3">
          {list.map((r) => (
            <li key={r.id}>
              <PromotionCard req={r} techName={names[r.technician_id]} levelName={levelName}>
                {isTodo(r) && (
                  <div className="mt-3 space-y-2">
                    <Input placeholder={staff ? '委員會意見' : '推薦意見'} value={comments[r.id] ?? ''}
                      onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" disabled={act.isPending} onClick={() => ask('確定不通過?') && act.mutate({ r, ok: false })}>不通過</Button>
                      <Button disabled={act.isPending} onClick={() => act.mutate({ r, ok: true })}>{staff ? '核可晉升' : '推薦'}</Button>
                    </div>
                  </div>
                )}
              </PromotionCard>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
