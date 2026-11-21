/**
 * 建立四種角色的測試帳號與示範資料(只用於開發/測試專案,勿對正式環境執行)
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... npm run seed:demo
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_PASSWORD
if (!url || !key || !password) {
  console.error('請設定 VITE_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、DEMO_PASSWORD')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const accounts = [
  { email: 'admin@demo.yijia', name: '系統管理員', role: 'admin' },
  { email: 'committee@demo.yijia', name: '工務主任 王主任', role: 'committee' },
  { email: 'mentor1@demo.yijia', name: '組長 陳師傅', role: 'mentor' },
  { email: 'mentor2@demo.yijia', name: '組長 林師傅', role: 'mentor' },
  { email: 'tech1@demo.yijia', name: '學徒 小張', role: 'technician', mentor: 'mentor1@demo.yijia' },
  { email: 'tech2@demo.yijia', name: '學徒 小李', role: 'technician', mentor: 'mentor1@demo.yijia' },
  { email: 'tech3@demo.yijia', name: '學徒 小黃', role: 'technician', mentor: 'mentor2@demo.yijia' },
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must<R extends { data: any; error: { message: string } | null }>(p: PromiseLike<R>): Promise<NonNullable<R['data']>> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

async function main() {
  const ids: Record<string, string> = {}
  const existing = await must(db.auth.admin.listUsers({ perPage: 1000 }))
  for (const a of accounts) {
    let user = existing.users.find((u) => u.email === a.email)
    if (!user) {
      user = (await must(db.auth.admin.createUser({ email: a.email, password, email_confirm: true, user_metadata: { full_name: a.name } }))).user as NonNullable<typeof user>
    }
    ids[a.email] = user.id
    await must(db.from('profiles').update({ full_name: a.name, role: a.role }).eq('id', user.id))
    console.log(`✔ ${a.role.padEnd(10)} ${a.email}`)
  }

  for (const a of accounts) {
    if (!('mentor' in a)) continue
    const tech = ids[a.email]
    const { data } = await db.from('mentor_assignments').select('id').eq('technician_id', tech).is('ends_on', null)
    if (!data?.length) await must(db.from('mentor_assignments').insert({ mentor_id: ids[a.mentor], technician_id: tech }))
  }

  // 示範資料:小張接近晉升初階;小李剛起步
  const t1 = ids['tech1@demo.yijia']
  const t2 = ids['tech2@demo.yijia']
  const m1 = ids['mentor1@demo.yijia']
  const { count } = await db.from('practice_hours').select('*', { count: 'exact', head: true }).eq('technician_id', t1)
  if (!count) {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
    await must(db.from('practice_hours').insert([
      ...Array.from({ length: 50 }, (_, i) => ({ technician_id: t1, work_date: day(i + 3), hours: 8, description: '跟車實作', status: 'approved', reviewer_id: m1, reviewed_at: new Date().toISOString() })),
      { technician_id: t1, work_date: day(1), hours: 8, description: '跟車處理浴室漏水', status: 'pending' },
      { technician_id: t2, work_date: day(1), hours: 6, description: '跟車熱水器更換', status: 'pending' },
    ]))
    await must(db.from('service_cases').insert(Array.from({ length: 20 }, (_, i) => ({
      technician_id: t1, external_ref: `DEMO-${1000 + i}`, completed_on: day(i + 1), quoted: true,
      converted: i % 3 !== 0, is_callback: i === 7, satisfaction: i % 4 === 0 ? 4 : 5, created_by: m1,
    }))))
  }
  console.log('✅ 完成')
}

main().catch((e) => { console.error(e); process.exit(1) })
