import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import { useScenarios } from '../../lib/queries'
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader } from '../../components/ui'

export default function ScenariosAdminPage() {
  const scenarios = useScenarios(true)
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const sc = await unwrap(supabase.from('scenarios').insert({ title, sort_order: (scenarios.data?.length ?? 0) + 1, is_active: false })
        .select('id').single<{ id: string }>())
      await unwrap(supabase.from('scenario_scenes').insert({ scenario_id: sc.id, key: 'start', sort_order: 1, narration: '(請輸入開場狀況)' }))
    },
    onSuccess: () => { setTitle(''); qc.invalidateQueries({ queryKey: ['scenarios'] }) },
  })
  if (scenarios.isLoading) return <Loading />
  return (
    <>
      <PageHeader title="情境劇" subtitle="新劇本預設為停用,編輯完成後再啟用" />
      <Card className="mb-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <Input required placeholder="新劇本名稱" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" disabled={create.isPending}>新增</Button>
        </form>
        <ErrorBox error={create.error} />
      </Card>
      <ul className="space-y-2">
        {scenarios.data?.map((s) => (
          <li key={s.id}>
            <Link to={`/admin/scenarios/${s.id}`}>
              <Card className="flex items-center justify-between p-3 transition hover:border-brand">
                <span className="font-medium">{s.title}</span>
                <span className="flex gap-1">{s.category && <Badge tone="brand">{s.category}</Badge>}{!s.is_active && <Badge>停用</Badge>}</span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
