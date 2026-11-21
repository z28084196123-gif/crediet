import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import { useLevels, useVisibleProfiles } from '../../lib/queries'
import type { PromotionProgress } from '../../lib/types'
import { overallPercent } from '../../lib/progress'
import { Badge, Card, Empty, Loading, PageHeader, ProgressBar } from '../../components/ui'

export default function TeamPage() {
  const me = useMe()
  const profiles = useVisibleProfiles()
  const levels = useLevels()
  const techs = (profiles.data ?? []).filter((p) => p.role === 'technician' && p.id !== me.id)

  const progress = useQueries({
    queries: techs.map((t) => ({
      queryKey: ['promotion_progress', t.id],
      queryFn: () => unwrap(supabase.rpc('promotion_progress', { p_tech: t.id })) as Promise<PromotionProgress>,
    })),
  })

  if (profiles.isLoading) return <Loading />
  const levelName = (id: string | null) => levels.data?.find((l) => l.id === id)?.name ?? '—'

  return (
    <>
      <PageHeader title={me.role === 'mentor' ? '我的團隊' : '技師總覽'} subtitle={`${techs.length} 位技師`} />
      {techs.length === 0 ? <Empty>目前沒有{me.role === 'mentor' ? '名下' : ''}技師</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {techs.map((t, i) => {
            const p = progress[i]?.data
            const pct = p ? overallPercent(p.requirements) : 0
            return (
              <li key={t.id}>
                <Link to={`/team/${t.id}`}>
                  <Card className="transition hover:border-brand">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{t.full_name}</div>
                      <Badge tone="brand">{levelName(t.current_level_id)}</Badge>
                    </div>
                    {p && !p.is_top_level ? (
                      <>
                        <div className="mt-3 flex justify-between text-xs text-muted">
                          <span>晉升{p.next_level?.name}</span>
                          <span>{p.eligible ? '✅ 已達標' : `${pct}%`}</span>
                        </div>
                        <div className="mt-1"><ProgressBar value={pct} tone={p.eligible ? 'ok' : 'brand'} /></div>
                      </>
                    ) : p ? <div className="mt-3 text-xs text-muted">已達最高職級</div> : <div className="mt-3 text-xs text-muted">載入中…</div>}
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
