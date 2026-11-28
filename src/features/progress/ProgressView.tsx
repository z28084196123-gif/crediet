import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { usePromotionProgress, useLevels } from '../../lib/queries'
import { gapText, overallPercent, requirementPercent, formatNumber } from '../../lib/progress'
import { requirementUnit } from '../../i18n/zh-TW'
import { Badge, Card, ErrorBox, Loading, ProgressBar } from '../../components/ui'

interface LevelHistoryRow { id: string; from_level_id: string | null; to_level_id: string; reason: string | null; created_at: string }

/** 技師晉升進度(技師本人與督導/委員會共用) */
export default function ProgressView({ techId, showLinks = false }: { techId: string; showLinks?: boolean }) {
  const prog = usePromotionProgress(techId)
  const levels = useLevels()
  const history = useQuery({
    queryKey: ['level_history', techId],
    queryFn: () => unwrap(supabase.from('level_history').select('*').eq('technician_id', techId)
      .order('created_at', { ascending: false }).returns<LevelHistoryRow[]>()),
  })

  if (prog.isLoading) return <Loading />
  if (prog.error) return <ErrorBox error={prog.error} />
  const p = prog.data!
  const levelName = (id: string | null) => levels.data?.find((l) => l.id === id)?.name ?? '—'
  const pct = overallPercent(p.requirements)

  return (
    <div className="space-y-4">
      {/* 職級階梯 */}
      <Card>
        <div className="text-sm text-muted">目前職級</div>
        <div className="mt-1 text-2xl font-bold">{p.current_level?.name ?? '未設定'}</div>
        <ol className="mt-4 flex items-center gap-1">
          {levels.data?.filter((l) => l.is_active).map((l, i, arr) => {
            const reached = (p.current_level?.rank ?? 0) >= l.rank
            return (
              <li key={l.id} className="flex flex-1 items-center gap-1">
                <div className={`flex-1 rounded-md px-1 py-1.5 text-center text-xs font-medium ${reached ? 'bg-brand text-white' : 'bg-subtle text-muted'}`}>
                  {l.name}
                </div>
                {i < arr.length - 1 && <span className="text-muted" aria-hidden>›</span>}
              </li>
            )
          })}
        </ol>
      </Card>

      {p.is_top_level ? (
        <Card><div className="text-center text-sm">已達最高職級 🎉</div></Card>
      ) : (
        <Card>
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-sm text-muted">晉升至</div>
              <div className="text-lg font-bold">{p.next_level?.name}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums text-brand">{pct}%</div>
              {p.eligible ? <Badge tone="ok">已達標,可申請晉升</Badge> : <Badge tone="warn">尚未達標</Badge>}
            </div>
          </div>
          <div className="mt-3"><ProgressBar value={pct} tone={p.eligible ? 'ok' : 'brand'} /></div>

          <ul className="mt-5 space-y-4">
            {p.requirements.map((r) => (
              <li key={r.requirement_id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {r.met ? '✅ ' : '⬜ '}{r.label}
                    {r.window_days && <span className="ml-1 text-xs text-muted">(近 {r.window_days} 天)</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {r.req_type === 'course' ? (r.met ? '已完成' : '未完成')
                      : `${formatNumber(r.current, 2)} / ${formatNumber(r.threshold, 2)} ${requirementUnit[r.req_type]}`}
                  </span>
                </div>
                <ProgressBar value={requirementPercent(r)} tone={r.met ? 'ok' : 'brand'} />
                {!r.met && (
                  <div className="mt-1 flex justify-between text-xs text-warn">
                    <span>{gapText(r)}</span>
                    {showLinks && r.course_id && <Link className="text-brand" to={`/courses/${r.course_id}`}>前往課程 →</Link>}
                    {showLinks && r.scenario_id && <Link className="text-brand" to={`/scenarios/${r.scenario_id}`}>去演練 →</Link>}
                    {showLinks && r.req_type === 'practice_hours' && <Link className="text-brand" to="/hours">登錄時數 →</Link>}
                  </div>
                )}
              </li>
            ))}
            {p.requirements.length === 0 && <li className="text-sm text-muted">此職級尚未設定晉升條件</li>}
          </ul>
          {showLinks && p.eligible && (
            <Link to="/promotion" className="mt-5 block rounded-lg bg-ok py-2.5 text-center text-sm font-medium text-white">送出晉升申請</Link>
          )}
        </Card>
      )}

      {(history.data?.length ?? 0) > 0 && (
        <Card>
          <div className="mb-2 font-medium">職級歷程</div>
          <ul className="space-y-2 text-sm">
            {history.data!.map((h) => (
              <li key={h.id} className="flex justify-between gap-2">
                <span>{levelName(h.from_level_id)} → <b>{levelName(h.to_level_id)}</b>{h.reason && <span className="text-muted">・{h.reason}</span>}</span>
                <span className="shrink-0 text-muted">{new Date(h.created_at).toLocaleDateString('zh-TW')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
