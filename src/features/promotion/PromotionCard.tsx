import type { ReactNode } from 'react'
import type { PromotionRequest } from '../../lib/types'
import { promotionStatusLabel, requirementUnit } from '../../i18n/zh-TW'
import { formatNumber } from '../../lib/progress'
import { Badge, Card } from '../../components/ui'

const tone = { submitted: 'warn', recommended: 'brand', approved: 'ok', rejected: 'danger', withdrawn: 'neutral' } as const

export default function PromotionCard({ req, techName, levelName, children }: {
  req: PromotionRequest
  techName?: string
  levelName: (id: string | null) => string
  children?: ReactNode
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          {techName && <div className="font-bold">{techName}</div>}
          <div className="text-sm">{levelName(req.from_level_id)} → <b>{levelName(req.to_level_id)}</b></div>
          <div className="text-xs text-muted">申請於 {new Date(req.created_at).toLocaleDateString('zh-TW')}</div>
        </div>
        <Badge tone={tone[req.status]}>{promotionStatusLabel[req.status]}</Badge>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-brand">送出時的條件達成狀況</summary>
        <ul className="mt-2 space-y-1">
          {req.progress_snapshot.requirements.map((r) => (
            <li key={r.requirement_id} className="flex justify-between gap-2">
              <span>{r.met ? '✅' : '⬜'} {r.label}</span>
              <span className="tabular-nums text-muted">
                {r.req_type === 'course' ? (r.met ? '已完成' : '未完成') : `${formatNumber(r.current, 2)} / ${formatNumber(r.threshold, 2)} ${requirementUnit[r.req_type]}`}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-3 space-y-1 text-sm">
        {req.technician_note && <p><span className="text-muted">技師說明:</span>{req.technician_note}</p>}
        {req.mentor_comment && <p><span className="text-muted">督導意見:</span>{req.mentor_comment}</p>}
        {req.decision_comment && <p><span className="text-muted">委員會意見:</span>{req.decision_comment}</p>}
      </div>
      {children}
    </Card>
  )
}
