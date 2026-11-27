import type { SupabaseClient } from '@supabase/supabase-js'
import { client, isConfigured, isDemo } from '@backend'

export { isConfigured, isDemo }
export const supabase = client as SupabaseClient

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
