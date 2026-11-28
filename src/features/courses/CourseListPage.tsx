import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import { useCourses, useScenarios } from '../../lib/queries'
import { Badge, Card, Empty, Loading, PageHeader } from '../../components/ui'

export default function CourseListPage() {
  const me = useMe()
  const courses = useCourses()
  const done = useQuery({
    queryKey: ['course_completions', me.id],
    queryFn: () => unwrap(supabase.from('course_completions').select('course_id').eq('technician_id', me.id).returns<{ course_id: string }[]>()),
  })
  const doneSet = new Set(done.data?.map((d) => d.course_id))
  const scenarios = useScenarios()
  const attempts = useQuery({
    queryKey: ['scenario_attempts', me.id],
    queryFn: () => unwrap(supabase.from('scenario_attempts').select('scenario_id, total_score, passed').eq('technician_id', me.id)
      .returns<{ scenario_id: string; total_score: number; passed: boolean }[]>()),
  })
  const best = (sid: string) => {
    const mine = (attempts.data ?? []).filter((a) => a.scenario_id === sid)
    return { tried: mine.length > 0, passed: mine.some((a) => a.passed), score: Math.max(0, ...mine.map((a) => Number(a.total_score))) }
  }

  if (courses.isLoading) return <Loading />
  return (
    <>
      {(scenarios.data?.length ?? 0) > 0 && (
        <section className="mb-6">
          <PageHeader title="情境演練" subtitle="模擬到府現場,你的每個選擇都會影響結局" />
          <ul className="grid gap-3 sm:grid-cols-2">
            {scenarios.data?.map((sc) => {
              const b = best(sc.id)
              return (
                <li key={sc.id}>
                  <Link to={`/scenarios/${sc.id}`}>
                    <Card className="h-full transition hover:border-brand">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">🎬 {sc.title}</div>
                        {b.passed ? <Badge tone="ok">通過・{b.score}</Badge> : b.tried ? <Badge tone="warn">最佳 {b.score}</Badge> : <Badge>未演練</Badge>}
                      </div>
                      {sc.category && <div className="mt-1"><Badge tone="brand">{sc.category}</Badge></div>}
                      {sc.description && <p className="mt-2 text-sm text-muted">{sc.description}</p>}
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <PageHeader title="課程" subtitle={`已完成 ${doneSet.size} / ${courses.data?.length ?? 0} 門`} />
      {courses.data?.length === 0 ? <Empty>目前沒有課程</Empty> : (
        <ul className="space-y-3">
          {courses.data?.map((c) => (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`}>
                <Card className="transition hover:border-brand">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{c.title}</div>
                    {doneSet.has(c.id) ? <Badge tone="ok">已完成</Badge> : <Badge>未完成</Badge>}
                  </div>
                  {c.category && <div className="mt-1"><Badge tone="brand">{c.category}</Badge></div>}
                  {c.description && <p className="mt-2 text-sm text-muted">{c.description}</p>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
