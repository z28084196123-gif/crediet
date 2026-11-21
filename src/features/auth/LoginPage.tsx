import { useState, type FormEvent } from 'react'
import { isConfigured, supabase } from '../../lib/supabase'
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
