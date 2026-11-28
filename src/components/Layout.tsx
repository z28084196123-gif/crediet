import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth, useMe } from '../lib/auth'
import type { AppRole } from '../lib/types'
import { roleLabel } from '../i18n/zh-TW'
import { cx } from './ui'

interface NavItem { to: string; label: string; icon: string }

const navByRole: Record<AppRole, NavItem[]> = {
  technician: [
    { to: '/me', label: '我的進度', icon: '📈' },
    { to: '/hours', label: '時數', icon: '⏱️' },
    { to: '/courses', label: '課程', icon: '📚' },
    { to: '/promotion', label: '晉升', icon: '🎖️' },
    { to: '/scoreboard', label: '計分板', icon: '🏆' },
  ],
  mentor: [
    { to: '/team', label: '團隊', icon: '👥' },
    { to: '/review/hours', label: '簽核', icon: '✅' },
    { to: '/cases', label: '案件評分', icon: '🧰' },
    { to: '/review/promotions', label: '晉升', icon: '🎖️' },
    { to: '/scoreboard', label: '計分板', icon: '🏆' },
  ],
  committee: [
    { to: '/team', label: '技師', icon: '👥' },
    { to: '/review/promotions', label: '晉升核可', icon: '🎖️' },
    { to: '/scoreboard', label: '計分板', icon: '🏆' },
    { to: '/cases', label: '案件', icon: '🧰' },
    { to: '/admin', label: '設定', icon: '⚙️' },
  ],
  admin: [
    { to: '/team', label: '技師', icon: '👥' },
    { to: '/review/promotions', label: '晉升核可', icon: '🎖️' },
    { to: '/scoreboard', label: '計分板', icon: '🏆' },
    { to: '/cases', label: '案件', icon: '🧰' },
    { to: '/admin', label: '設定', icon: '⚙️' },
  ],
}

export function homePath(role: AppRole): string {
  return navByRole[role][0].to
}

export default function Layout() {
  const me = useMe()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const items = navByRole[me.role]
  const logout = async () => {
    navigate('/', { replace: true })
    await signOut()
  }

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="font-bold text-ink">億家水電 · 技師養成</div>
          <nav className="hidden gap-1 md:flex">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to}
                className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-subtle')}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{me.full_name}・{roleLabel[me.role]}</span>
            <button onClick={logout} className="rounded-lg px-2 py-1 text-muted hover:bg-subtle">登出</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>

      {/* 手機底部導覽 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to}
            className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-brand' : 'text-muted')}>
            <span className="text-lg leading-none" aria-hidden>{i.icon}</span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
