import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from './supabase'
import type { CareerLevel, Course, Profile, PromotionProgress, Quiz, ScoreboardMetric, SopNode } from './types'

export function useLevels() {
  return useQuery({
    queryKey: ['career_levels'],
    queryFn: () => unwrap(supabase.from('career_levels').select('*').order('rank').returns<CareerLevel[]>()),
    staleTime: 60_000,
  })
}

/** 目前登入者看得到的所有 profile(RLS 決定範圍) */
export function useVisibleProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => unwrap(supabase.from('profiles').select('*').order('full_name').returns<Profile[]>()),
  })
}

export function useCourses(includeInactive = false) {
  return useQuery({
    queryKey: ['courses', includeInactive],
    queryFn: () => {
      let q = supabase.from('courses').select('*').order('sort_order').order('title')
      if (!includeInactive) q = q.eq('is_active', true)
      return unwrap(q.returns<Course[]>())
    },
  })
}

export function useQuizzes() {
  return useQuery({
    queryKey: ['quizzes'],
    queryFn: () => unwrap(supabase.from('quizzes').select('*').order('created_at').returns<Quiz[]>()),
  })
}

export function useSopNodes(includeInactive = false) {
  return useQuery({
    queryKey: ['sop_nodes', includeInactive],
    queryFn: () => {
      let q = supabase.from('sop_nodes').select('*').order('sort_order')
      if (!includeInactive) q = q.eq('is_active', true)
      return unwrap(q.returns<SopNode[]>())
    },
  })
}

export function useMetrics() {
  return useQuery({
    queryKey: ['scoreboard_metrics'],
    queryFn: () => unwrap(supabase.from('scoreboard_metrics').select('*').order('sort_order').returns<ScoreboardMetric[]>()),
  })
}

export function usePromotionProgress(techId: string | undefined) {
  return useQuery({
    queryKey: ['promotion_progress', techId],
    enabled: Boolean(techId),
    queryFn: () => unwrap(supabase.rpc('promotion_progress', { p_tech: techId })) as Promise<PromotionProgress>,
  })
}

export function nameMap(profiles: Profile[] | undefined): Record<string, string> {
  return Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]))
}
