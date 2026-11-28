import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import type { PracticeHours, Profile, ScenarioAttempt } from '../../lib/types'
import { useScenarios } from '../../lib/queries'
import { endingLabel, pointsLabel } from '../../i18n/zh-TW'
import { reviewStatusLabel } from '../../i18n/zh-TW'
import { formatNumber } from '../../lib/progress'
import { Badge, Card, ErrorBox, Loading, PageHeader } from '../../components/ui'
import ProgressView from '../progress/ProgressView'

export default function TechnicianDetailPage() {
  const { id } = useParams<{ id: string }>()
  const tech = useQuery({
    queryKey: ['profile', id],
    queryFn: () => unwrap(supabase.from('profiles').select('*').eq('id', id!).single<Profile>()),
  })
  const hours = useQuery({
    queryKey: ['practice_hours', id, 'recent'],
    queryFn: () => unwrap(supabase.from('practice_hours').select('*').eq('technician_id', id!)
      .order('work_date', { ascending: false }).limit(10).returns<PracticeHours[]>()),
  })

  const scenarios = useScenarios(true)
  const attempts = useQuery({
    queryKey: ['scenario_attempts', id, 'detail'],
    queryFn: () => unwrap(supabase.from('scenario_attempts').select('*').eq('technician_id', id!)
      .order('created_at', { ascending: false }).limit(10).returns<ScenarioAttempt[]>()),
  })

  if (tech.isLoading) return <Loading />
  if (tech.error) return <ErrorBox error={tech.error} />

  return (
    <>
      <PageHeader title={tech.data!.full_name} subtitle={tech.data!.phone ?? undefined} />
      <ProgressView techId={id!} />
      <Card className="mt-4">
        <div className="mb-2 font-medium">情境演練紀錄</div>
        <ul className="space-y-2 text-sm">
          {attempts.data?.map((a) => (
            <li key={a.id}>
              <details className="rounded-lg border border-line p-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{scenarios.data?.find((s) => s.id === a.scenario_id)?.title ?? '情境劇'}</span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums">
                    {formatNumber(a.total_score)} 分
                    <Badge tone={a.ending_type === 'good' ? 'ok' : a.ending_type === 'ok' ? 'warn' : 'danger'}>{endingLabel[a.ending_type]}</Badge>
                  </span>
                </summary>
                <ol className="mt-2 space-y-1 text-xs">
                  {a.path.map((p, i) => <li key={i}>{i + 1}. {p.choice} <b>({pointsLabel[p.points]})</b></li>)}
                </ol>
              </details>
            </li>
          ))}
          {attempts.data?.length === 0 && <li className="text-muted">還沒有演練紀錄</li>}
        </ul>
      </Card>
      <Card className="mt-4">
        <div className="mb-2 font-medium">最近時數紀錄</div>
        <ul className="divide-y divide-line text-sm">
          {hours.data?.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{h.work_date}・{h.description}</span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">{formatNumber(h.hours)}h
                <Badge tone={h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'danger' : 'warn'}>{reviewStatusLabel[h.status]}</Badge>
              </span>
            </li>
          ))}
          {hours.data?.length === 0 && <li className="py-2 text-muted">沒有紀錄</li>}
        </ul>
      </Card>
    </>
  )
}
