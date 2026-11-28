import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useSopNodes } from '../../lib/queries'
import type { ChoiceResult, Scenario, ScenarioChoice, ScenarioResult, ScenarioScene } from '../../lib/types'
import { endingLabel, pointsLabel } from '../../i18n/zh-TW'
import { isSafeHttpUrl, youtubeEmbedUrl } from '../../lib/media'
import { formatNumber } from '../../lib/progress'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, ProgressBar, cx } from '../../components/ui'

const pointTone = ['danger', 'warn', 'brand', 'ok'] as const
const pointBox = ['border-danger bg-danger-soft', 'border-warn bg-warn-soft', 'border-brand bg-brand-soft', 'border-ok bg-ok-soft']

function SceneMedia({ scene }: { scene: ScenarioScene }) {
  const embed = youtubeEmbedUrl(scene.media_url)
  if (embed) return <iframe className="aspect-video w-full rounded-lg" src={embed} title={scene.location ?? '場景'} allowFullScreen loading="lazy" />
  if (!isSafeHttpUrl(scene.media_url)) return null
  if (/\.(mp4|webm)(\?|$)/i.test(scene.media_url)) return <video className="w-full rounded-lg" src={scene.media_url} controls playsInline />
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(scene.media_url)) return <img className="w-full rounded-lg" src={scene.media_url} alt={scene.location ?? '場景'} />
  return <a className="text-sm text-brand underline" href={scene.media_url} target="_blank" rel="noreferrer">觀看場景影片 ↗</a>
}

function SceneCard({ scene }: { scene: ScenarioScene }) {
  return (
    <Card className="space-y-3">
      {scene.location && <div className="text-xs font-medium tracking-wide text-muted">📍 {scene.location}</div>}
      <SceneMedia scene={scene} />
      {scene.narration && <p className="text-sm leading-relaxed text-ink">{scene.narration}</p>}
      {scene.line && (
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
            {(scene.speaker ?? '客')[0]}
          </div>
          <div className="min-w-0 flex-1">
            {scene.speaker && <div className="mb-1 text-xs text-muted">{scene.speaker}</div>}
            <div className="rounded-2xl rounded-tl-sm bg-subtle px-4 py-3 text-base leading-relaxed">「{scene.line}」</div>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function ScenarioPlayerPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const nodes = useSopNodes()
  const [sceneKey, setSceneKey] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ choice: ScenarioChoice; result: ChoiceResult } | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [result, setResult] = useState<ScenarioResult | null>(null)

  const data = useQuery({
    queryKey: ['scenario', id],
    queryFn: async () => {
      const scenario = await unwrap(supabase.from('scenarios').select('*').eq('id', id!).single<Scenario>())
      const scenes = await unwrap(supabase.from('scenario_scenes').select('*').eq('scenario_id', id!).order('sort_order').returns<ScenarioScene[]>())
      const choices = scenes.length
        ? await unwrap(supabase.from('scenario_choices').select('*').in('scene_id', scenes.map((s) => s.id)).order('sort_order').returns<ScenarioChoice[]>())
        : []
      return { scenario, scenes, choices }
    },
  })

  const choose = useMutation({
    mutationFn: (choice: ScenarioChoice) =>
      unwrap(supabase.rpc('scenario_choice_result', { p_choice_id: choice.id })) as Promise<ChoiceResult>,
    onSuccess: (r, choice) => setPicked({ choice, result: r }),
  })

  const finish = useMutation({
    mutationFn: (ids: string[]) => unwrap(supabase.rpc('submit_scenario', { p_scenario_id: id, p_choice_ids: ids })) as Promise<ScenarioResult>,
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries({ queryKey: ['scenario_attempts'] })
      qc.invalidateQueries({ queryKey: ['promotion_progress'] })
      window.scrollTo(0, 0)
    },
  })

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const { scenario, scenes, choices } = data.data!
  const current = scenes.find((s) => s.key === (sceneKey ?? scenario.start_scene_key))
  const sceneChoices = choices.filter((c) => c.scene_id === current?.id)
  const nodeName = (code: string) => nodes.data?.find((n) => n.code === code)?.name ?? code

  function next() {
    if (!picked) return
    const ids = [...path, picked.choice.id]
    const target = scenes.find((s) => s.key === picked.result.next_scene_key)
    setPath(ids)
    setPicked(null)
    if (target?.ending_type) finish.mutate(ids)
    else setSceneKey(picked.result.next_scene_key)
    window.scrollTo(0, 0)
  }

  function restart() {
    setSceneKey(null)
    setPicked(null)
    setPath([])
    setResult(null)
    finish.reset()
    window.scrollTo(0, 0)
  }

  // ---------------- 結局 ----------------
  if (result) {
    const endScene = scenes.find((s) => s.key === result.ending.key)
    const tone = result.ending.type === 'good' ? 'ok' : result.ending.type === 'ok' ? 'warn' : 'danger'
    return (
      <>
        <PageHeader title={scenario.title} subtitle="演出結果" />
        <div className="space-y-4">
          {endScene && <SceneCard scene={endScene} />}
          <Card className={cx('text-center', tone === 'ok' ? 'border-ok' : tone === 'warn' ? 'border-warn' : 'border-danger')}>
            <Badge tone={tone}>{endingLabel[result.ending.type]}</Badge>
            <div className="mt-2 text-4xl font-bold tabular-nums">{formatNumber(result.score)} 分</div>
            <div className="mt-1 text-sm text-muted">
              {result.passed ? '通過 ✅' : result.ending.type === 'bad' ? '走到壞結局,不計入晉升' : `未達 ${result.pass_score} 分`}
            </div>
            {result.ending.summary && <p className="mt-3 text-sm">{result.ending.summary}</p>}
          </Card>

          {result.ending.mentor_comment && (
            <Card>
              <div className="mb-1 text-sm font-medium">🧑‍🔧 督導講評</div>
              <p className="text-sm leading-relaxed">{result.ending.mentor_comment}</p>
            </Card>
          )}

          {Object.keys(result.sop_scores).length > 0 && (
            <Card>
              <div className="mb-3 text-sm font-medium">SOP 節點表現</div>
              <ul className="space-y-3">
                {Object.entries(result.sop_scores).map(([code, v]) => (
                  <li key={code}>
                    <div className="mb-1 flex justify-between text-sm"><span>{nodeName(code)}</span><span className="tabular-nums">{formatNumber(v)}</span></div>
                    <ProgressBar value={v} tone={v >= 70 ? 'ok' : 'brand'} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <div className="mb-3 text-sm font-medium">回顧你的每個選擇</div>
            <ol className="space-y-3">
              {result.path.map((step, i) => (
                <li key={i} className={cx('rounded-lg border p-3 text-sm', pointBox[step.points])}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{i + 1}. {step.choice}</span>
                    <Badge tone={pointTone[step.points]}>{pointsLabel[step.points]}</Badge>
                  </div>
                  {step.feedback && <p className="mt-1 text-muted">{step.feedback}</p>}
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={restart}>再演一次</Button>
            <Link to="/courses" className="flex min-h-10 items-center justify-center rounded-lg bg-brand text-sm font-medium text-white">回到列表</Link>
          </div>
        </div>
      </>
    )
  }

  // ---------------- 演出中 ----------------
  if (!current) return <ErrorBox error={new Error('劇本設定有誤:找不到場景')} />
  return (
    <>
      <PageHeader title={scenario.title} subtitle={`第 ${path.length + 1} 幕・${scenario.pass_score} 分通過`} />
      <div className="space-y-4">
        {path.length === 0 && scenario.description && (
          <p className="rounded-lg bg-subtle p-3 text-sm text-muted">{scenario.description}</p>
        )}
        <SceneCard scene={current} />

        <div>
          <div className="mb-2 text-sm font-medium">你會怎麼做?</div>
          <div className="space-y-2">
            {sceneChoices.map((c) => {
              const isPicked = picked?.choice.id === c.id
              return (
                <button key={c.id} disabled={Boolean(picked) || choose.isPending} onClick={() => choose.mutate(c)}
                  className={cx('block w-full rounded-xl border p-3 text-left text-sm leading-relaxed transition',
                    isPicked ? pointBox[picked!.result.points] : picked ? 'border-line opacity-50' : 'border-line bg-surface hover:border-brand')}>
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>
        <ErrorBox error={choose.error ?? finish.error} />

        {picked && (
          <Card className={cx('space-y-2', pointBox[picked.result.points])}>
            <div className="flex items-center gap-2">
              <Badge tone={pointTone[picked.result.points]}>{pointsLabel[picked.result.points]}</Badge>
              {picked.result.sop_node_code && <span className="text-xs text-muted">SOP:{nodeName(picked.result.sop_node_code)}</span>}
            </div>
            {picked.result.feedback && <p className="text-sm leading-relaxed">{picked.result.feedback}</p>}
            <Button className="w-full" disabled={finish.isPending} onClick={next}>
              {scenes.find((s) => s.key === picked.result.next_scene_key)?.ending_type ? '看結果' : '繼續'}
            </Button>
          </Card>
        )}
      </div>
    </>
  )
}
