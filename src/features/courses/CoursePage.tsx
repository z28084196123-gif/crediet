import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap, unwrapMaybe } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import type { Course, CourseUnit, Quiz } from '../../lib/types'
import { isSafeHttpUrl, youtubeEmbedUrl } from '../../lib/media'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader } from '../../components/ui'

function UnitMedia({ unit }: { unit: CourseUnit }) {
  if (unit.unit_type === 'video') {
    const embed = youtubeEmbedUrl(unit.media_url)
    if (embed) return <iframe className="aspect-video w-full rounded-lg" src={embed} title={unit.title} allowFullScreen loading="lazy" />
    if (isSafeHttpUrl(unit.media_url)) return <a className="text-brand underline" href={unit.media_url} target="_blank" rel="noreferrer">開啟影片 ↗</a>
  }
  if (unit.unit_type === 'image' && isSafeHttpUrl(unit.media_url)) {
    return <img className="w-full rounded-lg" src={unit.media_url} alt={unit.title} loading="lazy" />
  }
  return null
}

export default function CoursePage() {
  const { id } = useParams<{ id: string }>()
  const me = useMe()
  const qc = useQueryClient()

  const data = useQuery({
    queryKey: ['course', id, me.id],
    queryFn: async () => {
      const [course, units, quizzes, progress, attempts, completion] = await Promise.all([
        unwrap(supabase.from('courses').select('*').eq('id', id!).single<Course>()),
        unwrap(supabase.from('course_units').select('*').eq('course_id', id!).order('sort_order').returns<CourseUnit[]>()),
        unwrap(supabase.from('quizzes').select('*').eq('course_id', id!).eq('is_active', true).returns<Quiz[]>()),
        unwrap(supabase.from('unit_progress').select('unit_id').eq('technician_id', me.id).returns<{ unit_id: string }[]>()),
        unwrap(supabase.from('quiz_attempts').select('quiz_id, score, passed').eq('technician_id', me.id).returns<{ quiz_id: string; score: number; passed: boolean }[]>()),
        unwrapMaybe(supabase.from('course_completions').select('completed_at').eq('course_id', id!).eq('technician_id', me.id).maybeSingle<{ completed_at: string }>()),
      ])
      return { course, units, quizzes, done: new Set(progress.map((p) => p.unit_id)), attempts, completion }
    },
  })

  const markDone = useMutation({
    mutationFn: (unitId: string) => unwrap(supabase.rpc('mark_unit_complete', { p_unit_id: unitId })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', id] })
      qc.invalidateQueries({ queryKey: ['course_completions'] })
      qc.invalidateQueries({ queryKey: ['promotion_progress'] })
    },
  })

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const { course, units, quizzes, done, attempts, completion } = data.data!

  return (
    <>
      <PageHeader title={course.title} subtitle={course.description}
        action={completion ? <Badge tone="ok">已完成</Badge> : <Badge>{done.size}/{units.length} 單元</Badge>} />
      <ol className="space-y-3">
        {units.map((u, i) => (
          <li key={u.id}>
            <Card>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-medium">{i + 1}. {u.title}</div>
                {done.has(u.id) && <Badge tone="ok">已讀</Badge>}
              </div>
              <div className="space-y-3">
                <UnitMedia unit={u} />
                {u.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{u.body}</p>}
              </div>
              {!done.has(u.id) && (
                <Button className="mt-3 w-full" variant="secondary" disabled={markDone.isPending} onClick={() => markDone.mutate(u.id)}>
                  我已讀完這個單元
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ol>
      <ErrorBox error={markDone.error} />

      {quizzes.length > 0 && (
        <div className="mt-5 space-y-3">
          <h2 className="font-bold">課後測驗</h2>
          {quizzes.map((q) => {
            const mine = attempts.filter((a) => a.quiz_id === q.id)
            const best = mine.reduce((m, a) => Math.max(m, Number(a.score)), 0)
            const passed = mine.some((a) => a.passed)
            const left = q.max_attempts ? q.max_attempts - mine.length : null
            return (
              <Card key={q.id}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{q.title}</div>
                  {passed ? <Badge tone="ok">已及格</Badge> : mine.length > 0 ? <Badge tone="warn">未及格</Badge> : <Badge>未作答</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted">
                  及格 {q.pass_score} 分{mine.length > 0 && `・最佳 ${best} 分`}{left !== null && `・剩 ${left} 次`}
                </div>
                {(left === null || left > 0) && (
                  <Link to={`/quiz/${q.id}`} className="mt-3 block rounded-lg bg-brand py-2.5 text-center text-sm font-medium text-white">
                    {mine.length > 0 ? '再測一次' : '開始測驗'}
                  </Link>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
