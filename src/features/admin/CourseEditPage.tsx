import { ask } from '../../lib/confirm'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import type { Course, CourseUnit, Quiz, QuizQuestion, UnitType } from '../../lib/types'
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea } from '../../components/ui'

const unitTypeLabel: Record<UnitType, string> = { text: '文字', video: '影片連結', image: '圖片' }

function UnitEditor({ unit, onDone }: { unit: Partial<CourseUnit> & { course_id: string }; onDone: () => void }) {
  const [d, setD] = useState(unit)
  const save = useMutation({
    mutationFn: () => {
      const row = { course_id: d.course_id, title: d.title, unit_type: d.unit_type ?? 'text', body: d.body || null, media_url: d.media_url || null, sort_order: d.sort_order ?? 0 }
      return d.id ? unwrap(supabase.from('course_units').update(row).eq('id', d.id)) : unwrap(supabase.from('course_units').insert(row))
    },
    onSuccess: onDone,
  })
  const del = useMutation({ mutationFn: () => unwrap(supabase.from('course_units').delete().eq('id', d.id!)), onSuccess: onDone })
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="grid grid-cols-[1fr_auto_5rem] gap-2">
        <Field label="單元標題"><Input value={d.title ?? ''} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
        <Field label="類型">
          <Select value={d.unit_type ?? 'text'} onChange={(e) => setD({ ...d, unit_type: e.target.value as UnitType })}>
            {Object.entries(unitTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="順序"><Input type="number" value={d.sort_order ?? 0} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })} /></Field>
      </div>
      {d.unit_type && d.unit_type !== 'text' && (
        <Field label={d.unit_type === 'video' ? '影片網址(YouTube 會自動嵌入)' : '圖片網址'}>
          <Input type="url" value={d.media_url ?? ''} onChange={(e) => setD({ ...d, media_url: e.target.value })} />
        </Field>
      )}
      <Field label="內容 / 說明"><Textarea rows={4} value={d.body ?? ''} onChange={(e) => setD({ ...d, body: e.target.value })} /></Field>
      <ErrorBox error={save.error ?? del.error} />
      <div className="flex justify-end gap-2">
        {d.id && <Button variant="ghost" className="text-danger" onClick={() => ask('刪除單元?') && del.mutate()}>刪除</Button>}
        <Button disabled={!d.title || save.isPending} onClick={() => save.mutate()}>{d.id ? '儲存' : '新增單元'}</Button>
      </div>
    </div>
  )
}

interface QDraft { id?: string; prompt: string; options: string[]; correct_index: number }

function QuizEditor({ quiz, onDone }: { quiz: Quiz; onDone: () => void }) {
  const [q, setQ] = useState(quiz)
  const [drafts, setDrafts] = useState<QDraft[]>([])
  const questions = useQuery({
    queryKey: ['quiz_questions_admin', quiz.id],
    queryFn: async () => {
      const qs = await unwrap(supabase.from('quiz_questions').select('*').eq('quiz_id', quiz.id).order('sort_order').order('id').returns<QuizQuestion[]>())
      const keys = await unwrap(supabase.from('quiz_answer_keys').select('*').in('question_id', qs.map((x) => x.id)).returns<{ question_id: string; correct_index: number }[]>())
      return qs.map((x) => ({ id: x.id, prompt: x.prompt, options: x.options, correct_index: keys.find((k) => k.question_id === x.id)?.correct_index ?? 0 }))
    },
  })
  useEffect(() => { if (questions.data) setDrafts(questions.data) }, [questions.data])

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(supabase.from('quizzes').update({ title: q.title, pass_score: q.pass_score, max_attempts: q.max_attempts, is_active: q.is_active }).eq('id', quiz.id))
      const keep = drafts.filter((d) => d.id).map((d) => d.id!)
      const removed = (questions.data ?? []).filter((x) => !keep.includes(x.id!)).map((x) => x.id!)
      if (removed.length) await unwrap(supabase.from('quiz_questions').delete().in('id', removed))
      for (const [i, d] of drafts.entries()) {
        const options = d.options.map((o) => o.trim()).filter(Boolean)
        if (!d.prompt.trim() || options.length < 2) throw new Error(`第 ${i + 1} 題需要題目與至少兩個選項`)
        if (d.correct_index >= options.length) throw new Error(`第 ${i + 1} 題的正解超出選項範圍`)
        const row = { quiz_id: quiz.id, prompt: d.prompt, options, sort_order: i + 1 }
        const saved = d.id
          ? await unwrap(supabase.from('quiz_questions').update(row).eq('id', d.id).select('id').single<{ id: string }>())
          : await unwrap(supabase.from('quiz_questions').insert(row).select('id').single<{ id: string }>())
        await unwrap(supabase.from('quiz_answer_keys').upsert({ question_id: saved.id, correct_index: d.correct_index }))
      }
    },
    onSuccess: () => { questions.refetch(); onDone() },
  })
  const upd = (i: number, patch: Partial<QDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  return (
    <Card>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="測驗名稱"><Input value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} /></Field>
        <Field label="及格分數"><Input type="number" min={0} max={100} value={q.pass_score} onChange={(e) => setQ({ ...q, pass_score: Number(e.target.value) })} /></Field>
        <Field label="作答次數上限" hint="空白 = 不限"><Input type="number" min={1} value={q.max_attempts ?? ''} onChange={(e) => setQ({ ...q, max_attempts: e.target.value ? Number(e.target.value) : null })} /></Field>
      </div>
      <Checkbox label="啟用" checked={q.is_active} onChange={(v) => setQ({ ...q, is_active: v })} />
      <ol className="mt-3 space-y-3">
        {drafts.map((d, i) => (
          <li key={d.id ?? `new-${i}`} className="space-y-2 rounded-lg border border-line p-3">
            <Field label={`第 ${i + 1} 題`}><Input value={d.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} /></Field>
            {d.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input type="radio" className="size-5" aria-label="設為正解" checked={d.correct_index === oi} onChange={() => upd(i, { correct_index: oi })} />
                <Input value={o} placeholder={`選項 ${oi + 1}`} onChange={(e) => upd(i, { options: d.options.map((x, k) => (k === oi ? e.target.value : x)) })} />
              </div>
            ))}
            <div className="flex justify-between text-sm">
              <button className="text-brand" onClick={() => upd(i, { options: [...d.options, ''] })}>＋ 選項</button>
              <button className="text-danger" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>刪除此題</button>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">圓點選取的選項即為正解;正解只有委員會/管理員看得到。</p>
      <ErrorBox error={save.error} />
      <div className="mt-3 flex justify-between">
        <Button variant="ghost" onClick={() => setDrafts([...drafts, { prompt: '', options: ['', '', ''], correct_index: 0 }])}>＋ 新增題目</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>儲存測驗</Button>
      </div>
    </Card>
  )
}

export default function CourseEditPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ['course_admin', id],
    queryFn: async () => ({
      course: await unwrap(supabase.from('courses').select('*').eq('id', id!).single<Course>()),
      units: await unwrap(supabase.from('course_units').select('*').eq('course_id', id!).order('sort_order').returns<CourseUnit[]>()),
      quizzes: await unwrap(supabase.from('quizzes').select('*').eq('course_id', id!).order('created_at').returns<Quiz[]>()),
    }),
  })
  const [c, setC] = useState<Course | null>(null)
  const [addingUnit, setAddingUnit] = useState(false)
  useEffect(() => { if (data.data) setC(data.data.course) }, [data.data])
  const refresh = () => { setAddingUnit(false); qc.invalidateQueries({ queryKey: ['course_admin', id] }); qc.invalidateQueries({ queryKey: ['courses'] }); qc.invalidateQueries({ queryKey: ['quizzes'] }) }

  const saveCourse = useMutation({
    mutationFn: () => unwrap(supabase.from('courses').update({ title: c!.title, description: c!.description, category: c!.category, sort_order: c!.sort_order, is_active: c!.is_active }).eq('id', id!)),
    onSuccess: refresh,
  })
  const addQuiz = useMutation({
    mutationFn: () => unwrap(supabase.from('quizzes').insert({ course_id: id, title: `${c?.title ?? ''} 測驗` })),
    onSuccess: refresh,
  })

  if (data.isLoading || !c) return <Loading />
  const { units, quizzes } = data.data!

  return (
    <>
      <PageHeader title="編輯課程" />
      <Card className="mb-4 space-y-2">
        <Field label="課程名稱"><Input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field>
        <Field label="說明"><Textarea value={c.description ?? ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="分類"><Input value={c.category ?? ''} placeholder="例:必修、法規、工法" onChange={(e) => setC({ ...c, category: e.target.value || null })} /></Field>
          <Field label="排序"><Input type="number" value={c.sort_order} onChange={(e) => setC({ ...c, sort_order: Number(e.target.value) })} /></Field>
        </div>
        <Checkbox label="啟用(停用後技師看不到,也不計入訓練完成度)" checked={c.is_active} onChange={(v) => setC({ ...c, is_active: v })} />
        <ErrorBox error={saveCourse.error} />
        <Button disabled={saveCourse.isPending} onClick={() => saveCourse.mutate()}>儲存課程</Button>
      </Card>

      <h2 className="mb-2 font-bold">單元</h2>
      <div className="space-y-3">
        {units.map((u) => <UnitEditor key={u.id + u.title + u.sort_order} unit={u} onDone={refresh} />)}
        {addingUnit ? <UnitEditor unit={{ course_id: id!, unit_type: 'text', sort_order: units.length + 1 }} onDone={refresh} />
          : <Button variant="ghost" onClick={() => setAddingUnit(true)}>＋ 新增單元</Button>}
      </div>

      <h2 className="mb-2 mt-6 font-bold">測驗</h2>
      <div className="space-y-3">
        {quizzes.map((q) => <QuizEditor key={q.id} quiz={q} onDone={refresh} />)}
        <ErrorBox error={addQuiz.error} />
        <Button variant="ghost" onClick={() => addQuiz.mutate()}>＋ 新增測驗</Button>
      </div>
    </>
  )
}
