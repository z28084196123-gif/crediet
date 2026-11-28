/**
 * 示範模式後端:在瀏覽器內用 PGlite 跑真正的 Postgres,套用同一份 migrations(含 RLS),
 * 並提供前端用到的 supabase-js 子集(from/select/insert/update/delete/upsert/rpc/auth)。
 */
import { PGlite, types, type Transaction } from '@electric-sql/pglite'
import shimSql from '../../supabase/tests/00_supabase_shim.sql?raw'
import seedSql from './seed.sql?raw'
import pgliteWasmUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.wasm?url'
import initdbWasmUrl from '../../node_modules/@electric-sql/pglite/dist/initdb.wasm?url'
import { demoAccounts, type DemoAccount } from './accounts'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const isDemo = true
export const isConfigured = true


// ---------------------------------------------------------------------------
// 資料庫
// ---------------------------------------------------------------------------
const ts = (x: string) => new Date(x.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString()
let dbPromise: Promise<PGlite> | null = null

async function loadAsset(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`無法載入示範資料庫檔案(${res.status})`)
  return res
}

/**
 * PGlite 的檔案系統資料包。Artifact 不提供 .data 類型的檔案,
 * 建置時(scripts/build-demo.sh)把它 gzip + base64 成文字檔,這裡解回來。
 */
async function loadFsBundle(): Promise<Blob> {
  const text = await (await loadAsset(new URL('assets/pglite-data.gz.txt', document.baseURI).href)).text()
  const bin = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0))
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).blob()
}

export function getDb(): Promise<PGlite> {
  dbPromise ??= (async () => {
    // 從頁面旁的檔案載入 wasm 與資料檔(Artifact 環境不允許從 CDN fetch)
    const [pgWasm, initWasm, fsData] = await Promise.all([
      loadAsset(pgliteWasmUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
      loadAsset(initdbWasmUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
      loadFsBundle(),
    ])
    const db = await PGlite.create({
      pgliteWasmModule: pgWasm,
      initdbWasmModule: initWasm,
      fsBundle: fsData,
      parsers: {
        [types.NUMERIC]: (v: string) => Number(v),
        [types.INT8]: (v: string) => Number(v),
        [types.DATE]: (v: string) => v,
        [types.TIMESTAMPTZ]: ts,
        [types.TIMESTAMP]: ts,
      },
    })
    await db.exec(shimSql)
    for (const key of Object.keys(migrations).sort()) await db.exec(migrations[key])
    await db.exec(seedSql)
    return db
  })()
  return dbPromise
}

// ---------------------------------------------------------------------------
// 登入狀態
// ---------------------------------------------------------------------------
type Listener = (event: string, session: unknown) => void
let currentUser: DemoAccount | null = null
const listeners = new Set<Listener>()

function sessionOf(u: DemoAccount | null) {
  if (!u) return null
  return {
    access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' },
  }
}

function emit(event: string) {
  const s = sessionOf(currentUser)
  listeners.forEach((l) => l(event, s))
}

const auth = {
  async getSession() {
    await getDb()
    return { data: { session: sessionOf(currentUser) }, error: null }
  },
  onAuthStateChange(cb: Listener) {
    listeners.add(cb)
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
  },
  async signInWithPassword({ email }: { email: string; password?: string }) {
    const u = demoAccounts.find((a) => a.email === email)
    if (!u) return { data: { session: null, user: null }, error: { message: '找不到示範帳號' } }
    currentUser = u
    emit('SIGNED_IN')
    return { data: { session: sessionOf(u), user: sessionOf(u)!.user }, error: null }
  },
  async signOut() {
    currentUser = null
    emit('SIGNED_OUT')
    return { error: null }
  },
}

// ---------------------------------------------------------------------------
// 查詢:每次查詢都以目前使用者身分(role authenticated + JWT sub)執行,RLS 生效
// ---------------------------------------------------------------------------
async function asUser<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      currentUser ? JSON.stringify({ sub: currentUser.id, role: 'authenticated' }) : '',
    ])
    await tx.exec(currentUser ? 'set local role authenticated' : 'set local role anon')
    return fn(tx)
  })
}

const IDENT = /^[a-z_][a-z0-9_]*$/
function q(id: string): string {
  if (!IDENT.test(id)) throw new Error(`不支援的欄位名稱:${id}`)
  return `"${id}"`
}
const toParam = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

// 中繼資料(以超級使用者身分查,結果快取)
const metaCache = new Map<string, Promise<unknown>>()
function meta<T>(key: string, sql: string, params: unknown[]): Promise<T> {
  if (!metaCache.has(key)) metaCache.set(key, getDb().then((db) => db.query(sql, params)).then((r) => r.rows as T))
  return metaCache.get(key) as Promise<T>
}

/** 找出 child 表參照 parent 表的外鍵欄位,用於 select('*, child(cols)') */
async function fkColumn(child: string, parent: string): Promise<string> {
  const rows = await meta<{ col: string }[]>(`fk:${child}:${parent}`, `
    select a.attname as col from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.conrelid = ('public.' || $1)::regclass and c.confrelid = ('public.' || $2)::regclass
    limit 1`, [child, parent])
  if (!rows[0]) throw new Error(`找不到 ${child} → ${parent} 的關聯`)
  return rows[0].col
}

async function primaryKey(table: string): Promise<string[]> {
  const rows = await meta<{ col: string }[]>(`pk:${table}`, `
    select a.attname as col from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [table])
  return rows.map((r) => r.col)
}

async function isSetReturning(fn: string): Promise<boolean> {
  const rows = await meta<{ retset: boolean }[]>(`fn:${fn}`, `
    select proretset as retset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn])
  return Boolean(rows[0]?.retset)
}

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

async function selectList(table: string, cols: string, alias: string): Promise<string> {
  const parts: string[] = []
  for (const item of splitTop(cols || '*')) {
    if (item === '*') { parts.push(`${alias}.*`); continue }
    const m = item.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/)
    if (m) {
      const [, rel, sub] = m
      const fk = await fkColumn(rel, table)
      const subCols = sub === '*' ? `to_json(x)` : `json_build_object(${splitTop(sub).map((c) => `'${c}', x.${q(c)}`).join(', ')})`
      parts.push(`coalesce((select json_agg(${subCols}) from public.${q(rel)} x where x.${q(fk)} = ${alias}.id), '[]'::json) as ${q(rel)}`)
      continue
    }
    parts.push(`${alias}.${q(item)}`)
  }
  return parts.join(', ')
}

type Filter = { col: string; op: 'eq' | 'neq' | 'is' | 'in'; val: unknown }
type Resp = { data: unknown; error: { message: string } | null; count?: number | null }

class Query implements PromiseLike<Resp> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private cols = '*'
  private returning: string | null = null
  private filters: Filter[] = []
  private orders: { col: string; asc: boolean }[] = []
  private limitN: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private payload: Record<string, unknown>[] = []
  private onConflict: string | null = null
  private countOnly = false

  constructor(private table: string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.cols = cols
      this.countOnly = Boolean(opts?.head)
    } else this.returning = cols
    return this
  }
  insert(v: Record<string, unknown> | Record<string, unknown>[]) { this.op = 'insert'; this.payload = Array.isArray(v) ? v : [v]; return this }
  upsert(v: Record<string, unknown> | Record<string, unknown>[], o?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = Array.isArray(v) ? v : [v]; this.onConflict = o?.onConflict ?? null; return this
  }
  update(v: Record<string, unknown>) { this.op = 'update'; this.payload = [v]; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push({ col, op: 'eq', val }); return this }
  neq(col: string, val: unknown) { this.filters.push({ col, op: 'neq', val }); return this }
  is(col: string, val: unknown) { this.filters.push({ col, op: 'is', val }); return this }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: 'in', val }); return this }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending ?? true }); return this }
  limit(n: number) { this.limitN = n; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  returns() { return this }

  private where(params: unknown[], alias: string): string {
    if (!this.filters.length) return ''
    const conds = this.filters.map((f) => {
      const c = `${alias}.${q(f.col)}`
      if (f.op === 'is') return f.val === null ? `${c} is null` : `${c} is ${f.val ? 'true' : 'false'}`
      if (f.op === 'in') {
        const arr = f.val as unknown[]
        if (!arr.length) return 'false'
        return `${c} in (${arr.map((v) => { params.push(v); return `$${params.length}` }).join(', ')})`
      }
      params.push(toParam(f.val))
      return `${c} ${f.op === 'eq' ? '=' : '<>'} $${params.length}`
    })
    return ` where ${conds.join(' and ')}`
  }

  private async build(): Promise<{ sql: string; params: unknown[]; wantsRows: boolean }> {
    const t = `public.${q(this.table)}`
    const params: unknown[] = []
    if (this.op === 'select') {
      if (this.countOnly) return { sql: `select count(*)::int as count from ${t} t${this.where(params, 't')}`, params, wantsRows: true }
      let sql = `select ${await selectList(this.table, this.cols, 't')} from ${t} t${this.where(params, 't')}`
      if (this.orders.length) sql += ` order by ${this.orders.map((o) => `t.${q(o.col)} ${o.asc ? 'asc' : 'desc'}`).join(', ')}`
      if (this.limitN !== null) sql += ` limit ${Number(this.limitN)}`
      return { sql, params, wantsRows: true }
    }
    const ret = this.returning !== null ? ` returning ${this.returning === '*' ? '*' : splitTop(this.returning).map(q).join(', ')}` : ''
    if (this.op === 'insert' || this.op === 'upsert') {
      const cols = [...new Set(this.payload.flatMap((r) => Object.keys(r)))]
      const values = this.payload.map((r) => `(${cols.map((c) => {
        if (!(c in r)) return 'default'
        params.push(toParam(r[c]))
        return `$${params.length}`
      }).join(', ')})`)
      let sql = `insert into ${t} (${cols.map(q).join(', ')}) values ${values.join(', ')}`
      if (this.op === 'upsert') {
        const conflict = this.onConflict ? this.onConflict.split(',').map((s) => s.trim()) : await primaryKey(this.table)
        const updates = cols.filter((c) => !conflict.includes(c))
        sql += ` on conflict (${conflict.map(q).join(', ')}) do ${updates.length ? `update set ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}` : 'nothing'}`
      }
      return { sql: sql + ret, params, wantsRows: this.returning !== null }
    }
    if (this.op === 'update') {
      const set = Object.entries(this.payload[0]).map(([k, v]) => { params.push(toParam(v)); return `${q(k)} = $${params.length}` })
      return { sql: `update ${t} as t set ${set.join(', ')}${this.where(params, 't')}${ret}`, params, wantsRows: this.returning !== null }
    }
    return { sql: `delete from ${t} as t${this.where(params, 't')}${ret}`, params, wantsRows: this.returning !== null }
  }

  async execute(): Promise<Resp> {
    try {
      const { sql, params, wantsRows } = await this.build()
      const rows = (await asUser((tx) => tx.query(sql, params))).rows as Record<string, unknown>[]
      if (this.countOnly) return { data: null, error: null, count: Number(rows[0]?.count ?? 0) }
      if (!wantsRows) return { data: null, error: null }
      if (this.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: { message: rows.length ? '查詢結果不只一筆' : '找不到資料(或沒有權限)' } }
        return { data: rows[0], error: null }
      }
      if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    } catch (e) {
      return { data: null, error: { message: friendly(e) } }
    }
  }

  then<A = Resp, B = never>(ok?: ((v: Resp) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(ok, fail)
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('row-level security')) return '沒有權限執行這個動作'
  return msg
}

/** 函式參數型別(陣列參數要轉成 Postgres 陣列格式,其餘物件轉 JSON) */
async function argTypes(fn: string): Promise<Record<string, string>> {
  const rows = await meta<{ name: string; type: string }[]>(`args:${fn}`, `
    select unnest(proargnames) as name, unnest(proargtypes::regtype[]::text[]) as type
    from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])
  return Object.fromEntries(rows.map((r) => [r.name, r.type]))
}

function pgArray(v: unknown[]): string {
  return `{${v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/["\\]/g, '\\$&')}"`)).join(',')}}`
}

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Resp> {
  try {
    const entries = Object.entries(args).filter(([, v]) => v !== undefined)
    const types = await argTypes(fn)
    const params = entries.map(([k, v]) => (Array.isArray(v) && types[k]?.endsWith('[]') ? pgArray(v) : toParam(v)))
    const call = `public.${q(fn)}(${entries.map(([k], i) => `${q(k)} => $${i + 1}`).join(', ')})`
    const sql = (await isSetReturning(fn))
      ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from ${call} t`
      : `select to_jsonb(${call}) as r`
    const rows = (await asUser((tx) => tx.query(sql, params))).rows as { r: unknown }[]
    return { data: rows[0]?.r ?? null, error: null }
  } catch (e) {
    return { data: null, error: { message: friendly(e) } }
  }
}

export const client = {
  auth,
  from: (table: string) => new Query(table),
  rpc,
}
