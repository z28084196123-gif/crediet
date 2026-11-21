import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useAuth } from './lib/auth'
import type { AppRole } from './lib/types'
import Layout, { homePath } from './components/Layout'
import { Loading } from './components/ui'
import LoginPage from './features/auth/LoginPage'
import MyProgressPage from './features/progress/MyProgressPage'
import MyHoursPage from './features/hours/MyHoursPage'
import HoursReviewPage from './features/hours/HoursReviewPage'
import CourseListPage from './features/courses/CourseListPage'
import CoursePage from './features/courses/CoursePage'
import QuizPage from './features/courses/QuizPage'
import MyPromotionPage from './features/promotion/MyPromotionPage'
import PromotionQueuePage from './features/promotion/PromotionQueuePage'
import CasesPage from './features/sop/CasesPage'
import CaseScorePage from './features/sop/CaseScorePage'
import ScoreboardPage from './features/scoreboard/ScoreboardPage'
import TeamPage from './features/team/TeamPage'
import TechnicianDetailPage from './features/team/TechnicianDetailPage'
import AdminHomePage from './features/admin/AdminHomePage'
import LevelsAdminPage from './features/admin/LevelsAdminPage'
import CoursesAdminPage from './features/admin/CoursesAdminPage'
import CourseEditPage from './features/admin/CourseEditPage'
import ScoringAdminPage from './features/admin/ScoringAdminPage'
import SettingsAdminPage from './features/admin/SettingsAdminPage'
import UsersAdminPage from './features/admin/UsersAdminPage'
import AuditLogPage from './features/admin/AuditLogPage'

const ALL: AppRole[] = ['technician', 'mentor', 'committee', 'admin']
const MANAGERS: AppRole[] = ['mentor', 'committee', 'admin']
const STAFF: AppRole[] = ['committee', 'admin']
const ADMIN: AppRole[] = ['admin']

/** 前端路由守衛只是使用體驗;真正的權限由資料庫 RLS 把關 */
function Guard({ roles, children }: { roles: AppRole[]; children: ReactElement }) {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" replace />
  if (!roles.includes(profile.role)) return <Navigate to={homePath(profile.role)} replace />
  return children
}

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  if (!profile) return <div className="p-6 text-center text-sm text-muted">找不到你的人員資料,請聯絡管理員。</div>
  if (!profile.is_active) return <div className="p-6 text-center text-sm text-muted">帳號已停用,請聯絡管理員。</div>

  const g = (roles: AppRole[], el: ReactElement) => <Guard roles={roles}>{el}</Guard>
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={homePath(profile.role)} replace />} />
        <Route path="me" element={g(ALL, <MyProgressPage />)} />
        <Route path="hours" element={g(ALL, <MyHoursPage />)} />
        <Route path="courses" element={g(ALL, <CourseListPage />)} />
        <Route path="courses/:id" element={g(ALL, <CoursePage />)} />
        <Route path="quiz/:id" element={g(ALL, <QuizPage />)} />
        <Route path="promotion" element={g(ALL, <MyPromotionPage />)} />
        <Route path="scoreboard" element={g(ALL, <ScoreboardPage />)} />
        <Route path="cases" element={g(ALL, <CasesPage />)} />
        <Route path="cases/:id" element={g(ALL, <CaseScorePage />)} />

        <Route path="team" element={g(MANAGERS, <TeamPage />)} />
        <Route path="team/:id" element={g(MANAGERS, <TechnicianDetailPage />)} />
        <Route path="review/hours" element={g(MANAGERS, <HoursReviewPage />)} />
        <Route path="review/promotions" element={g(MANAGERS, <PromotionQueuePage />)} />

        <Route path="admin" element={g(STAFF, <AdminHomePage />)} />
        <Route path="admin/levels" element={g(STAFF, <LevelsAdminPage />)} />
        <Route path="admin/courses" element={g(STAFF, <CoursesAdminPage />)} />
        <Route path="admin/courses/:id" element={g(STAFF, <CourseEditPage />)} />
        <Route path="admin/scoring" element={g(STAFF, <ScoringAdminPage />)} />
        <Route path="admin/audit" element={g(STAFF, <AuditLogPage />)} />
        <Route path="admin/users" element={g(ADMIN, <UsersAdminPage />)} />
        <Route path="admin/settings" element={g(ADMIN, <SettingsAdminPage />)} />
        <Route path="*" element={<Navigate to={homePath(profile.role)} replace />} />
      </Route>
    </Routes>
  )
}
