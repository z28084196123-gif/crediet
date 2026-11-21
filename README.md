# 億家水電 技師教育訓練與晉升系統

分級養成(學徒 → 初階 → 中階 → 資深)+ SOP 五節點評分 + 績效計分板 + 督導簽核。
技術棧:React + Vite + TypeScript + Tailwind、Supabase(Auth / Postgres / RLS)、Vercel。

> 所有晉升門檻、計分板權重、SOP 評分項目都是**草案預設值**(非 Mr. Rooter 官方數字),
> 存在資料表中,委員會/管理員可在「設定」頁修改,修改會寫入稽核紀錄。

## 角色與權限(由資料庫 RLS 把關)

| 角色 | 可看 | 可做 |
|---|---|---|
| 技師 `technician` | 只有自己 | 登錄時數、上課、測驗、送晉升申請 |
| 督導/組長 `mentor` | 名下技師(`mentor_assignments`) | 簽核時數、建案與 SOP 評分、推薦晉升 |
| 委員會 `committee` | 全部 | 核可晉升、設定職級/課程/權重/SOP、結算計分板 |
| 管理員 `admin` | 全部 | 上述全部 + 人員角色、督導對應、全域設定、手動調整職級 |

狀態變更(時數簽核、晉升、測驗評分、結算)只能透過 Postgres RPC 函式,前端無法直接改狀態欄位。

## 部署步驟

1. 建立 Supabase 專案,依序執行 `supabase/migrations/*.sql`(`supabase db push` 或在 SQL Editor 貼上執行)。
   - **不要**執行 `supabase/tests/` 內的檔案,那是本機測試用的 auth 模擬層。
2. 複製 `.env.example` 為 `.env.local`,填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
3. (測試專案)建立四種角色的測試帳號與示範資料:
   ```bash
   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=自訂密碼 npm run seed:demo
   ```
   帳號:`admin@ / committee@ / mentor1@ / mentor2@ / tech1@ / tech2@ / tech3@demo.yijia`
4. Vercel:匯入 repo,Framework 選 Vite,設定兩個 `VITE_` 環境變數(`vercel.json` 已處理 SPA 路由)。
5. 正式人員帳號在 Supabase Authentication 建立,首次建立會自動產生 profile(職級為學徒、角色為技師),再由管理員在「人員與督導」調整。

## 開發與測試

```bash
npm install
npm run dev          # 本機開發
npm run typecheck
npm test             # 前端單元測試(vitest)
npm run test:db      # 資料庫測試:需本機 Postgres 16,設定 PGHOST/PGPORT/PGUSER
```

`npm run test:db` 會建立乾淨資料庫 → 套用 Supabase 相容層 → 所有 migrations → 測試:
- `20_rls.sql`:技師看不到他人資料、組長只看名下技師、委員會看全部、未登入看不到任何資料、技師不能自行核准/升級/改權重
- `30_flows.sql`:驗收流程(進度與缺口、時數簽核後才計入、測驗與課程完成、晉升申請→推薦→核可→職級與歷程更新、改權重後計分板重算、結算快照、作答次數上限)

## 結構

```
supabase/migrations/
  …01_core.sql                  角色、職級、profiles、督導對應、設定、稽核、權限輔助函式
  …02_training.sql              課程/單元/測驗/正解/作答、實作時數、晉升條件
  …03_cases_sop_scoreboard.sql  案件、SOP 節點與評分、計分指標與快照、晉升申請與歷程
  …04_functions.sql             進度計算、簽核、測驗評分、晉升流程、計分板計算/結算
  …05_defaults.sql              草案預設值(四級職涯、五個 SOP 節點、指標權重、範例課程)
supabase/tests/                 本機測試(auth 相容層、fixtures、RLS、流程)
scripts/                        db-test.sh、seed-demo.ts
src/features/                   progress, hours, courses, promotion, sop, scoreboard, team, admin
```

## 可調整的設定

| 位置 | 內容 |
|---|---|
| 職級與晉升條件 | 職級名稱/啟用;每級條件:時數、指定課程、測驗分數、案件數、滿意度、SOP 平均;可設統計區間(近 N 天) |
| 計分板與 SOP | 指標權重、換算區間(原始值 → 0–100)、越高/越低越好、啟用;SOP 節點名稱、評分項目、權重 |
| 全域設定 | `hours_reset_on_promotion` 晉升後時數是否重新累計;`promotion_requires_mentor` 是否必經督導推薦;`sop_scorer_weights` 督導/客戶評分權重;`scoreboard_period` |

計分板計算:每個指標 `score = clamp((原始值 − 下限) / (上限 − 下限)) × 100`(越低越好則 100 − score),
總分 = 有資料指標的加權平均(沒資料的指標不列入,權重按比例重新分配)。

## 第二階段(尚未實作)

- 億家系統 2.0 串接:`service_cases` 已預留 `source`、`external_ref`、`dual_signoff`、`raw` 欄位,待取得工單欄位規格後寫 adapter 匯入。
- AI 模擬訓練:`quiz_attempts.source` 已預留 `ai_simulation`,待定義回寫介面。
- 督導求助(電話/視訊)紀錄與案例複盤。
- 獎金公式對接:目前已可「結算本期快照」(`scoreboard_snapshots`,含當時權重)與匯出 CSV,正式格式待確認。
