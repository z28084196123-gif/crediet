/** 示範模式的測試帳號(對應 src/demo/seed.sql) */
export interface DemoAccount { id: string; email: string; name: string; role: string; desc: string }
export const demoAccounts: DemoAccount[] = [
  { id: '00000000-0000-0000-0000-0000000000d1', email: 'tech1@demo', name: '小張', role: '學徒', desc: '時數差 8 小時,必修課與情境演練還沒完成' },
  { id: '00000000-0000-0000-0000-0000000000d2', email: 'tech2@demo', name: '小李', role: '學徒', desc: '已達標,晉升申請待組長推薦' },
  { id: '00000000-0000-0000-0000-0000000000b1', email: 'mentor1@demo', name: '陳組長', role: '督導/組長', desc: '帶小張、小李,有待簽核時數' },
  { id: '00000000-0000-0000-0000-0000000000b2', email: 'mentor2@demo', name: '林組長', role: '督導/組長', desc: '帶小黃' },
  { id: '00000000-0000-0000-0000-0000000000c1', email: 'committee@demo', name: '張主任', role: '教育訓練委員會', desc: '小黃的晉升待核可' },
  { id: '00000000-0000-0000-0000-0000000000a1', email: 'admin@demo', name: '王經理', role: '管理員', desc: '全部權限' },
]
