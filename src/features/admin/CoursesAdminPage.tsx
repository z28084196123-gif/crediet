import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useCourses } from '../../lib/queries'
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader } from '../../components/ui'

export default function CoursesAdminPage() {
  const courses = useCourses(true)
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const create = useMutation({
    mutationFn: () => unwrap(supabase.from('courses').insert({ title, sort_order: (courses.data?.length ?? 0) + 1 })),
    onSuccess: () => { setTitle(''); qc.invalidateQueries({ queryKey: ['courses'] }) },
  })
  if (courses.isLoading) return <Loading />
  return (
    <>
      <PageHeader title="課程與測驗" />
      <Card className="mb-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <Input required placeholder="新課程名稱" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" disabled={create.isPending}>新增</Button>
        </form>
        <ErrorBox error={create.error} />
      </Card>
      <ul className="space-y-2">
        {courses.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/admin/courses/${c.id}`}>
              <Card className="flex items-center justify-between p-3 transition hover:border-brand">
                <span className="font-medium">{c.title}</span>
                <span className="flex gap-1">{c.category && <Badge tone="brand">{c.category}</Badge>}{!c.is_active && <Badge>停用</Badge>}</span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
