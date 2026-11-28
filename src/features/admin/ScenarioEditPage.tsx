import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { ask } from '../../lib/confirm'
import { useSopNodes } from '../../lib/queries'
import type { EndingType, Scenario, ScenarioChoice, ScenarioScene } from '../../lib/types'
import { endingLabel, pointsLabel } from '../../i18n/zh-TW'
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea } from '../../components/ui'

interface ChoiceDraft { id?: string; label: string; next_scene_key: string; points: number; sop_node_code: string; feedback: string }
type ChoiceKey = { choice_id: string; points: number; sop_node_code: string | null; feedback: string | null }

function SceneEditor({ scene, allKeys, choices, keys, onDone }: {
  scene: ScenarioScene; allKeys: string[]; choices: ScenarioChoice[]; keys: ChoiceKey[]; onDone: () => void
}) {
  const nodes = useSopNodes()
  const [d, setD] = useState(scene)
  const [cs, setCs] = useState<ChoiceDraft[]>(() => choices.map((c) => {
    const k = keys.find((x) => x.choice_id === c.id)
    return { id: c.id, label: c.label, next_scene_key: c.next_scene_key, points: k?.points ?? 0, sop_node_code: k?.sop_node_code ?? '', feedback: k?.feedback ?? '' }
  }))
  const isEnding = Boolean(d.ending_type)
  const upd = (i: number, p: Partial<ChoiceDraft>) => setCs(cs.map((c, j) => (j === i ? { ...c, ...p } : c)))

  const save = useMutation({
    mutationFn: async () => {
      if (!/^[a-z0-9_]+$/.test(d.key)) throw new Error('場景代碼只能用小寫英文、數字與底線')
      await unwrap(supabase.from('scenario_scenes').update({
        key: d.key, sort_order: d.sort_order, location: d.location || null, speaker: d.speaker || null, line: d.line || null,
        narration: d.narration || null, media_url: d.media_url || null, ending_type: d.ending_type,
        ending_summary: d.ending_summary || null, mentor_comment: d.mentor_comment || null,
      }).eq('id', scene.id))
      const list = isEnding ? [] : cs
      const keep = list.filter((c) => c.id).map((c) => c.id!)
      const removed = choices.filter((c) => !keep.includes(c.id)).map((c) => c.id)
      if (removed.length) await unwrap(supabase.from('scenario_choices').delete().in('id', removed))
      for (const [i, c] of list.entries()) {
        if (!c.label.trim() || !c.next_scene_key) throw new Error(`選項 ${i + 1} 需要文字與下一個場景`)
        const row = { scene_id: scene.id, label: c.label, next_scene_key: c.next_scene_key, sort_order: i + 1 }
        const saved = c.id
          ? await unwrap(supabase.from('scenario_choices').update(row).eq('id', c.id).select('id').single<{ id: string }>())
          : await unwrap(supabase.from('scenario_choices').insert(row).select('id').single<{ id: string }>())
        await unwrap(supabase.from('scenario_choice_keys').upsert({
          choice_id: saved.id, points: c.points, sop_node_code: c.sop_node_code || null, feedback: c.feedback || null,
        }))
      }
    },
    onSuccess: onDone,
  })
  const del = useMutation({ mutationFn: () => unwrap(supabase.from('scenario_scenes').delete().eq('id', scene.id)), onSuccess: onDone })

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={isEnding ? (d.ending_type === 'good' ? 'ok' : d.ending_type === 'ok' ? 'warn' : 'danger') : 'brand'}>
            {isEnding ? endingLabel[d.ending_type!] : '場景'}
          </Badge>
          <span className="font-mono text-sm">{scene.key}</span>
        </div>
        <Select className="w-auto" value={d.ending_type ?? ''} onChange={(e) => setD({ ...d, ending_type: (e.target.value || null) as EndingType | null })}>
          <option value="">一般場景(有選項)</option>
          <option value="good">結局:好</option>
          <option value="ok">結局:普通</option>
          <option value="bad">結局:壞(不及格)</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="場景代碼"><Input value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })} /></Field>
        <Field label="地點"><Input value={d.location ?? ''} onChange={(e) => setD({ ...d, location: e.target.value })} /></Field>
      </div>
      <Field label="旁白/現場狀況"><Textarea value={d.narration ?? ''} onChange={(e) => setD({ ...d, narration: e.target.value })} /></Field>
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <Field label="說話的人"><Input value={d.speaker ?? ''} onChange={(e) => setD({ ...d, speaker: e.target.value })} /></Field>
        <Field label="台詞"><Input value={d.line ?? ''} onChange={(e) => setD({ ...d, line: e.target.value })} /></Field>
      </div>
      <Field label="圖片或影片網址(選填)" hint="YouTube 會自動嵌入;也可放 AI 生成或自己拍的短劇">
        <Input type="url" value={d.media_url ?? ''} onChange={(e) => setD({ ...d, media_url: e.target.value })} />
      </Field>

      {isEnding ? (
        <>
          <Field label="結果摘要"><Input value={d.ending_summary ?? ''} onChange={(e) => setD({ ...d, ending_summary: e.target.value })} /></Field>
          <Field label="督導講評"><Textarea value={d.mentor_comment ?? ''} onChange={(e) => setD({ ...d, mentor_comment: e.target.value })} /></Field>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-medium">選項</div>
          {cs.map((c, i) => (
            <div key={c.id ?? `n${i}`} className="space-y-2 rounded-lg border border-line p-2">
              <Textarea rows={2} placeholder="技師的回應/行動" value={c.label} onChange={(e) => upd(i, { label: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Select value={c.next_scene_key} onChange={(e) => upd(i, { next_scene_key: e.target.value })} aria-label="下一個場景">
                  <option value="">下一個場景…</option>
                  {allKeys.filter((k) => k !== scene.key).map((k) => <option key={k} value={k}>→ {k}</option>)}
                </Select>
                <Select value={c.points} onChange={(e) => upd(i, { points: Number(e.target.value) })} aria-label="分數">
                  {pointsLabel.map((l, p) => <option key={p} value={p}>{p} 分・{l}</option>)}
                </Select>
                <Select value={c.sop_node_code} onChange={(e) => upd(i, { sop_node_code: e.target.value })} aria-label="SOP 節點">
                  <option value="">SOP 節點…</option>
                  {nodes.data?.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
                </Select>
              </div>
              <Input placeholder="講評(選擇後立即顯示)" value={c.feedback} onChange={(e) => upd(i, { feedback: e.target.value })} />
              <button className="text-xs text-danger" onClick={() => setCs(cs.filter((_, j) => j !== i))}>刪除選項</button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setCs([...cs, { label: '', next_scene_key: '', points: 2, sop_node_code: '', feedback: '' }])}>＋ 新增選項</Button>
        </div>
      )}
      <ErrorBox error={save.error ?? del.error} />
      <div className="flex justify-end gap-2">
        {scene.key !== 'start' && <Button variant="ghost" className="text-danger" onClick={() => ask('刪除這個場景?') && del.mutate()}>刪除場景</Button>}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>儲存場景</Button>
      </div>
    </Card>
  )
}

export default function ScenarioEditPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ['scenario_admin', id],
    queryFn: async () => {
      const scenario = await unwrap(supabase.from('scenarios').select('*').eq('id', id!).single<Scenario>())
      const scenes = await unwrap(supabase.from('scenario_scenes').select('*').eq('scenario_id', id!).order('sort_order').order('key').returns<ScenarioScene[]>())
      const choices = scenes.length ? await unwrap(supabase.from('scenario_choices').select('*').in('scene_id', scenes.map((s) => s.id)).order('sort_order').returns<ScenarioChoice[]>()) : []
      const keys = choices.length ? await unwrap(supabase.from('scenario_choice_keys').select('*').in('choice_id', choices.map((c) => c.id)).returns<ChoiceKey[]>()) : []
      return { scenario, scenes, choices, keys }
    },
  })
  const [s, setS] = useState<Scenario | null>(null)
  const [newKey, setNewKey] = useState('')
  useEffect(() => { if (data.data) setS(data.data.scenario) }, [data.data])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['scenario_admin', id] }); qc.invalidateQueries({ queryKey: ['scenarios'] }); qc.invalidateQueries({ queryKey: ['scenario', id] }) }

  const saveScenario = useMutation({
    mutationFn: () => unwrap(supabase.from('scenarios').update({ title: s!.title, description: s!.description, category: s!.category, pass_score: s!.pass_score, sort_order: s!.sort_order, is_active: s!.is_active }).eq('id', id!)),
    onSuccess: refresh,
  })
  const addScene = useMutation({
    mutationFn: () => {
      if (!/^[a-z0-9_]+$/.test(newKey)) throw new Error('場景代碼只能用小寫英文、數字與底線,例如 end_good')
      return unwrap(supabase.from('scenario_scenes').insert({ scenario_id: id, key: newKey, sort_order: (data.data?.scenes.length ?? 0) + 1 }))
    },
    onSuccess: () => { setNewKey(''); refresh() },
  })

  if (data.isLoading || !s) return <Loading />
  const { scenes, choices, keys } = data.data!
  const allKeys = scenes.map((x) => x.key)
  // 檢查:選項指向不存在的場景、或沒有任何結局
  const broken = choices.filter((c) => !allKeys.includes(c.next_scene_key))
  const hasEnding = scenes.some((x) => x.ending_type)

  return (
    <>
      <PageHeader title="編輯情境劇" />
      <Card className="mb-4 space-y-2">
        <Field label="劇本名稱"><Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
        <Field label="說明(開場前顯示)"><Textarea value={s.description ?? ''} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="分類"><Input value={s.category ?? ''} onChange={(e) => setS({ ...s, category: e.target.value || null })} /></Field>
          <Field label="通過分數"><Input type="number" min={0} max={100} value={s.pass_score} onChange={(e) => setS({ ...s, pass_score: Number(e.target.value) })} /></Field>
          <Field label="排序"><Input type="number" value={s.sort_order} onChange={(e) => setS({ ...s, sort_order: Number(e.target.value) })} /></Field>
        </div>
        <Checkbox label="啟用(技師看得到)" checked={s.is_active} onChange={(v) => setS({ ...s, is_active: v })} />
        <p className="text-xs text-muted">計分:每個選擇 0–3 分,總分 = 平均 ÷ 3 × 100。走到「壞結局」一律不及格。</p>
        <ErrorBox error={saveScenario.error} />
        <Button disabled={saveScenario.isPending} onClick={() => saveScenario.mutate()}>儲存劇本設定</Button>
      </Card>

      {(broken.length > 0 || !hasEnding) && (
        <div className="mb-4 rounded-lg bg-warn-soft p-3 text-sm text-warn">
          {!hasEnding && <div>⚠️ 還沒有任何結局場景,技師無法演完。</div>}
          {broken.map((c) => <div key={c.id}>⚠️ 選項「{c.label.slice(0, 20)}…」指向不存在的場景「{c.next_scene_key}」</div>)}
        </div>
      )}

      <div className="space-y-4">
        {scenes.map((sc) => (
          <SceneEditor key={sc.id + sc.key} scene={sc} allKeys={allKeys}
            choices={choices.filter((c) => c.scene_id === sc.id)} keys={keys} onDone={refresh} />
        ))}
      </div>

      <Card className="mt-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addScene.mutate() }}>
          <Input required placeholder="新場景代碼,例如 end_good" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <Button type="submit" disabled={addScene.isPending}>新增場景</Button>
        </form>
        <ErrorBox error={addScene.error} />
      </Card>
    </>
  )
}
