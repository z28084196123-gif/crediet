import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from './supabase'
import type { AppRole, Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  const profileQ = useQuery({
    queryKey: ['profile', uid],
    enabled: Boolean(uid),
    queryFn: () => unwrap(supabase.from('profiles').select('*').eq('id', uid!).single<Profile>()),
  })

  const value: AuthState = {
    session,
    profile: profileQ.data ?? null,
    loading: !ready || (Boolean(uid) && profileQ.isLoading),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** 目前登入者的 profile(只能在已登入的頁面使用) */
export function useMe(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('尚未登入')
  return profile
}

export const isStaffRole = (r: AppRole) => r === 'committee' || r === 'admin'
export const canManageRole = (r: AppRole) => r === 'mentor' || isStaffRole(r)
