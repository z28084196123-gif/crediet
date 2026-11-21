import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMetrics, useSopNodes } from '../../lib/queries'
import type { ScoreboardMetric, SopNode } from '../../lib/types'
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Textarea } from '../../components/ui'

function MetricsEditor({ metrics }: { metrics: ScoreboardMetric[] }) {
  const qc = useQueryClient()
  const [d, setD] = useState(metrics)
  const total = d.filter((m) => m.is_active).reduce((s, m) => s + Number(m.weight), 0)
  const upd = (i: number, p: Partial<ScoreboardMetric>) => setD(d.map((m, j) => (j === i ? { ...m, ...p } : m)))
  const save = useMutation({
    mutationFn: async () => {
      for (const m of d) {
        const orig = metrics.find((x) => x.id === m.id)
        if (JSON.stringify(orig) === JSON.stringify(m)) continue
        if (Number(m.norm_max) <= Number(m.norm_min)) throw new Error(`「${m.name}」換算區間上限需大於下限`)
        await unwrap(supabase.from('scoreboard_metrics').update({
          name: m.name, description: m.description, weight: m.weight, higher_is_better: m.higher_is_better,
          norm_min: m.norm_min, norm_max: m.norm_max, is_active: m.is_active,
        }).eq('id', m.id))
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scoreboard_metrics'] })
      qc.invalidateQueries({ queryKey: ['scoreboard'] })
    },
  })
  return (
    <Card>
      <div className="mb-1 font-bold">計分板指標與權重</div>
      <p className="mb-3 text-xs text-muted">原始值落在「換算區間」內線性換算為 0–100 分,再依權重加權平均。權重不必加總為 100,系統會按比例計算。修改後計分板立即重算。</p>
      <div className="space-y-3">
        {d.map((m, i) => (
          <div key={m.id} className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <Input className="max-w-56 font-medium" value={m.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <Checkbox label="啟用" checked={m.is_active} onChange={(v) => upd(i, { is_active: v })} />
            </div>
            <p className="mt-1 text-xs text-muted">{m.description}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Field label="權重"><Input type="number" min={0} step="any" value={m.weight} onChange={(e) => upd(i, { weight: Number(e.target.value) })} /></Field>
              <Field label="區間下限"><Input type="number" step="any" value={m.norm_min} onChange={(e) => upd(i, { norm_min: Number(e.target.value) })} /></Field>
              <Field label="區間上限"><Input type="number" step="any" value={m.norm_max} onChange={(e) => upd(i, { norm_max: Number(e.target.value) })} /></Field>
            </div>
            <Checkbox label="越低越好(例如回修率)" checked={!m.higher_is_better} onChange={(v) => upd(i, { higher_is_better: !v })} />
            {m.is_active && total > 0 && <div className="text-xs text-muted">實際占比 {(Number(m.weight) / total * 100).toFixed(1)}%</div>}
          </div>
        ))}
      </div>
      <ErrorBox error={save.error} />
      {save.isSuccess && <div className="mt-2 text-sm text-ok">已儲存,計分板已依新權重重算</div>}
      <Button className="mt-3 w-full" disabled={save.isPending} onClick={() => save.mutate()}>儲存指標設定</Button>
    </Card>
  )
}

function SopNodesEditor({ nodes }: { nodes: SopNode[] }) {
  const qc = useQueryClient()
  const [d, setD] = useState(nodes.map((n) => ({ ...n, criteriaText: n.criteria.join('\n') })))
  const upd = (i: number, p: Partial<(typeof d)[number]>) => setD(d.map((n, j) => (j === i ? { ...n, ...p } : n)))
  const save = useMutation({
    mutationFn: async () => {
      for (const n of d) {
        await unwrap(supabase.from('sop_nodes').update({
          name: n.name, description: n.description, weight: n.weight, sort_order: n.sort_order, is_active: n.is_active,
          criteria: n.criteriaText.split('\n').map((s) => s.trim()).filter(Boolean),
        }).eq('id', n.id))
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sop_nodes'] }); qc.invalidateQueries({ queryKey: ['scoreboard'] }) },
  })
  return (
    <Card>
      <div className="mb-1 font-bold">SOP 節點</div>
      <p className="mb-3 text-xs text-muted">評分為 1–5 分;權重用於計算 SOP 平均分數。</p>
      <div className="space-y-3">
        {d.map((n, i) => (
          <div key={n.id} className="space-y-2 rounded-lg border border-line p-3">
            <div className="grid grid-cols-[1fr_5rem_5rem] gap-2">
              <Field label="名稱"><Input value={n.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
              <Field label="權重"><Input type="number" min={0} step="any" value={n.weight} onChange={(e) => upd(i, { weight: Number(e.target.value) })} /></Field>
              <Field label="順序"><Input type="number" value={n.sort_order} onChange={(e) => upd(i, { sort_order: Number(e.target.value) })} /></Field>
            </div>
            <Field label="評分項目(一行一項)"><Textarea rows={4} value={n.criteriaText} onChange={(e) => upd(i, { criteriaText: e.target.value })} /></Field>
            <Checkbox label="啟用" checked={n.is_active} onChange={(v) => upd(i, { is_active: v })} />
          </div>
        ))}
      </div>
      <ErrorBox error={save.error} />
      {save.isSuccess && <div className="mt-2 text-sm text-ok">已儲存</div>}
      <Button className="mt-3 w-full" disabled={save.isPending} onClick={() => save.mutate()}>儲存 SOP 節點</Button>
    </Card>
  )
}

export default function ScoringAdminPage() {
  const metrics = useMetrics()
  const nodes = useSopNodes(true)
  if (metrics.isLoading || nodes.isLoading) return <Loading />
  return (
    <>
      <PageHeader title="計分板與 SOP" subtitle="預設權重為草案,可依公司制度調整" />
      <div className="space-y-4">
        <MetricsEditor metrics={metrics.data ?? []} />
        <SopNodesEditor nodes={nodes.data ?? []} />
      </div>
    </>
  )
}
