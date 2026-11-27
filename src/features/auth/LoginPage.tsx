import { useState, type FormEvent } from 'react'
import { isConfigured, isDemo, supabase } from '../../lib/supabase'
import { demoAccounts } from '../../demo/accounts'
import { Button, Card, ErrorBox, Field, Input } from '../../components/ui'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(new Error(error.message === 'Invalid login credentials' ? '帳號或密碼錯誤' : error.message))
    setBusy(false)
  }

  if (isDemo) return <DemoLogin />

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-bold">億家水電 技師養成系統</h1>
        <p className="mb-5 mt-1 text-sm text-muted">請使用公司配發的帳號登入</p>
        {!isConfigured && (
          <div className="mb-4 rounded-lg bg-warn-soft p-3 text-sm text-warn">
            尚未設定 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY,請參考 .env.example。
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Field label="電子郵件">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="密碼">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? '登入中…' : '登入'}</Button>
        </form>
      </Card>
    </div>
  )
}

function DemoLogin() {
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold">億家水電 技師養成系統</h1>
        <p className="mt-1 text-sm text-muted">
          試用版:資料庫在你的瀏覽器裡執行,權限規則與正式版相同。重新整理頁面會恢復成初始示範資料。
        </p>
      </div>
      <p className="text-sm font-medium">選一個身分登入:</p>
      <ul className="space-y-2">
        {demoAccounts.map((a) => (
          <li key={a.id}>
            <button
              disabled={busy !== null}
              onClick={async () => { setBusy(a.id); await supabase.auth.signInWithPassword({ email: a.email, password: 'demo' }); setBusy(null) }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-brand disabled:opacity-60">
              <span>
                <span className="font-medium">{a.name}</span>
                <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">{a.role}</span>
                <span className="mt-0.5 block text-xs text-muted">{a.desc}</span>
              </span>
              <span className="text-muted">{busy === a.id ? '…' : '›'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">提示:可以用小張登錄時數 → 換陳組長簽核 → 再換回小張看進度更新。右上角「登出」可切換身分。</p>
    </div>
  )
}
