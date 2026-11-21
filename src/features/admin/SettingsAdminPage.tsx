import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import type { AppSetting } from '../../lib/types'
import { settingLabel } from '../../i18n/zh-TW'
import { Button, Card, ErrorBox, Field, Loading, PageHeader, Textarea } from '../../components/ui'

function SettingRow({ s }: { s: AppSetting }) {
  const qc = useQueryClient()
  const [text, setText] = useState(JSON.stringify(s.value, null, 1))
  const save = useMutation({
    mutationFn: () => {
      let value: unknown
      try { value = JSON.parse(text) } catch { throw new Error('格式錯誤:請輸入合法的 JSON(例如 true、"month"、{"mentor":1})') }
      return unwrap(supabase.from('app_settings').update({ value }).eq('key', s.key))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app_settings'] }),
  })
  return (
    <Card>
      <Field label={settingLabel[s.key] ?? s.key} hint={s.description ?? undefined}>
        <Textarea rows={1} className="font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
      <div className="mt-2 flex items-center justify-end gap-2">
        {save.isSuccess && <span className="text-sm text-ok">已儲存</span>}
        <Button disabled={save.isPending || text === JSON.stringify(s.value, null, 1)} onClick={() => save.mutate()}>儲存</Button>
      </div>
    </Card>
  )
}

export default function SettingsAdminPage() {
  const settings = useQuery({
    queryKey: ['app_settings'],
    queryFn: () => unwrap(supabase.from('app_settings').select('*').order('key').returns<AppSetting[]>()),
  })
  if (settings.isLoading) return <Loading />
  return (
    <>
      <PageHeader title="全域設定" subtitle="僅管理員可修改,所有變更會記錄在稽核紀錄" />
      <div className="space-y-3">{settings.data?.map((s) => <SettingRow key={s.key} s={s} />)}</div>
    </>
  )
}
