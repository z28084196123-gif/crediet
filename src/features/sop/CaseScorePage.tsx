import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { canManageRole, useMe } from '../../lib/auth'
import { nameMap, useSopNodes, useVisibleProfiles } from '../../lib/queries'
import type { ServiceCase, SopScore } from '../../lib/types'
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, cx } from '../../components/ui'

type Scorer = 'mentor' | 'customer'
interface Draft { score: number | null; comment: string }

export default function CaseScorePage() {
  const { id } = useParams<{ id: string }>()
  const me = useMe()
  const manage = canManageRole(me.role)
  const qc = useQueryClient()
  const nodes = useSopNodes()
  const profiles = useVisibleProfiles()
  const names = nameMap(profiles.data)
  const [scorer, setScorer] = useState<Scorer>('mentor')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const data = useQuery({
    queryKey: ['case', id],
    queryFn: async () => ({
      c: await unwrap(supabase.from('service_cases').select('*').eq('id', id!).single<ServiceCase>()),
      scores: await unwrap(supabase.from('sop_scores').select('*').eq('case_id', id!).returns<SopScore[]>()),
    }),
  })

  // 切換評分者時,把既有分數載入草稿
  useEffect(() => {
    if (!data.data) return
    const d: Record<string, Draft> = {}
    for (const s of data.data.scores.filter((x) => x.scorer_type === scorer)) d[s.node_id] = { score: Number(s.score), comment: s.comment ?? '' }
    setDrafts(d)
  }, [data.data, scorer])

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(drafts)
        .filter(([, d]) => d.score !== null)
        .map(([node_id, d]) => ({ case_id: id!, node_id, scorer_type: scorer, score: d.score, comment: d.comment || null, scorer_id: me.id }))
      if (rows.length === 0) throw new Error('請至少評一個節點')
      // technician_id 由資料庫 trigger 依案件帶入;這裡給值只是為了通過型別,實際會被覆寫
      const withTech = rows.map((r) => ({ ...r, technician_id: data.data!.c.technician_id }))
      return unwrap(supabase.from('sop_scores').upsert(withTech, { onConflict: 'case_id,node_id,scorer_type' }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', id] })
      qc.invalidateQueries({ queryKey: ['service_cases'] })
    },
  })

  if (data.isLoading || nodes.isLoading) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const { c, scores } = data.data!
  const setDraft = (nodeId: string, patch: Partial<Draft>) =>
    setDrafts({ ...drafts, [nodeId]: { ...(drafts[nodeId] ?? { score: null, comment: '' }), ...patch } })

  return (
    <>
      <PageHeader title={`案件 ${c.external_ref ?? ''}`} subtitle={`${names[c.technician_id] ?? ''}・完工 ${c.completed_on}`} />
      <div className="mb-4 flex flex-wrap gap-1">
        {c.quoted && <Badge>{c.converted ? '已成交' : '未成交'}</Badge>}
        {c.is_callback && <Badge tone="danger">回修</Badge>}
        {c.satisfaction && <Badge tone="brand">客戶滿意度 {c.satisfaction}</Badge>}
      </div>

      {manage && (
        <div className="mb-4 inline-flex rounded-lg border border-line p-1 text-sm">
          {(['mentor', 'customer'] as const).map((s) => (
            <button key={s} onClick={() => setScorer(s)} className={cx('rounded-md px-3 py-1.5', scorer === s ? 'bg-brand text-white' : 'text-muted')}>
              {s === 'mentor' ? '督導評分' : '客戶回饋(代填)'}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-3">
        {nodes.data?.map((n, i) => {
          const existing = scores.filter((s) => s.node_id === n.id)
          const d = drafts[n.id]
          return (
            <li key={n.id}>
              <Card>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{i + 1}. {n.name}</div>
                  <div className="flex gap-1">
                    {existing.map((s) => <Badge key={s.id} tone="brand">{s.scorer_type === 'mentor' ? '督導' : '客戶'} {s.score}</Badge>)}
                  </div>
                </div>
                {n.criteria.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-muted">
                    {n.criteria.map((cr) => <li key={cr}>{cr}</li>)}
                  </ul>
                )}
                {manage && (
                  <>
                    <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={`${n.name} 分數`}>
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button key={v} type="button" role="radio" aria-checked={d?.score === v}
                          onClick={() => setDraft(n.id, { score: v })}
                          className={cx('min-h-11 rounded-lg border text-base font-medium', d?.score === v ? 'border-brand bg-brand text-white' : 'border-line')}>
                          {v}
                        </button>
                      ))}
                    </div>
                    <Input className="mt-2" placeholder="備註(選填)" value={d?.comment ?? ''} onChange={(e) => setDraft(n.id, { comment: e.target.value })} />
                  </>
                )}
                {!manage && existing.map((s) => s.comment && <p key={s.id} className="mt-2 text-sm">💬 {s.comment}</p>)}
              </Card>
            </li>
          )
        })}
      </ol>
      {manage && (
        <>
          <ErrorBox error={save.error} />
          {save.isSuccess && <div className="mt-3 rounded-lg bg-ok-soft p-3 text-sm text-ok">已儲存</div>}
          <Button className="mt-4 w-full" disabled={save.isPending} onClick={() => save.mutate()}>儲存評分</Button>
        </>
      )}
    </>
  )
}
