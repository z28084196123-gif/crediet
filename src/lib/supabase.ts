import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

type Result<T> = PromiseLike<{ data: T; error: { message: string } | null }>

/** 把 Supabase 回傳的 { data, error } 轉成 throw,方便搭配 react-query。查詢成功時 data 不為 null。 */
export async function unwrap<T>(p: Result<T>): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as NonNullable<T>
}

/** 同 unwrap,但允許查無資料(搭配 maybeSingle) */
export async function unwrapMaybe<T>(p: Result<T>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}
