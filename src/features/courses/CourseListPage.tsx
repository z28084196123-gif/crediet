import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useMe } from '../../lib/auth'
import { useCourses } from '../../lib/queries'
import { Badge, Card, Empty, Loading, PageHeader } from '../../components/ui'

export default function CourseListPage() {
  const me = useMe()
  const courses = useCourses()
  const done = useQuery({
    queryKey: ['course_completions', me.id],
    queryFn: () => unwrap(supabase.from('course_completions').select('course_id').eq('technician_id', me.id).returns<{ course_id: string }[]>()),
  })
  const doneSet = new Set(done.data?.map((d) => d.course_id))

  if (courses.isLoading) return <Loading />
  return (
    <>
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
