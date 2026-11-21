import { Link } from 'react-router-dom'
import { useMe } from '../../lib/auth'
import { Card, PageHeader } from '../../components/ui'

const items = [
  { to: '/admin/levels', title: '職級與晉升條件', desc: '四級職涯、各級時數/課程/測驗/案件/滿意度門檻' },
  { to: '/admin/courses', title: '課程與測驗', desc: '課程單元(文字/影片/圖片)、測驗題目與正解' },
  { to: '/admin/scoring', title: '計分板與 SOP', desc: '指標權重、換算區間、SOP 節點與評分項目' },
  { to: '/admin/users', title: '人員與督導', desc: '角色、督導對應、職級手動調整', adminOnly: true },
  { to: '/admin/settings', title: '全域設定', desc: '時數累計方式、晉升流程、評分者權重', adminOnly: true },
  { to: '/admin/audit', title: '稽核紀錄', desc: '誰、何時、改了什麼' },
]

export default function AdminHomePage() {
  const me = useMe()
  return (
    <>
      <PageHeader title="設定" subtitle="所有門檻與權重皆為草案預設值,可依公司制度調整;修改會留下稽核紀錄" />
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.filter((i) => !i.adminOnly || me.role === 'admin').map((i) => (
          <li key={i.to}>
            <Link to={i.to}><Card className="h-full transition hover:border-brand">
              <div className="font-medium">{i.title}</div>
              <div className="mt-1 text-sm text-muted">{i.desc}</div>
            </Card></Link>
          </li>
        ))}
      </ul>
    </>
  )
}
