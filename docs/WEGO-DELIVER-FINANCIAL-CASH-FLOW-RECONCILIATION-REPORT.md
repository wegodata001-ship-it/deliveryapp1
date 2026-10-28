# WEGO DELIVER — FINANCIAL CASH FLOW RECONCILIATION REPORT

**תאריך:** 2026-10-28  
**שלב:** A–D (AUDIT, תוכנית, תיקון קוד מקומי, בדיקות READ-ONLY)  
**Production writes / Migration / Push / Deploy:** לא בוצעו (אישור מפורש נדרש).

---

## 1. Root causes מאומתים

| # | תופעה | שורש | מצב אחרי תיקון |
|---|--------|------|----------------|
| RC-1 | «10 חריגות» לשבוע ללא ספירה | `getFlowWeekVarianceLines` + סינון על `WAITING_FOR_COUNT` / `countedAmount == null` — כל ערוץ (~6) נספר כחריגה | KPI ומודל «פערים והתחייבויות» משתמשים ב-`flow-week-business-reconciliation.ts`; `verifiedExceptionCount` רק כשספירת מנהל **COMPLETE** + פער SHORTAGE/SURPLUS |
| RC-2 | AH-146 נפתח כ-AH-133 | `selectedRow` נפל ל-`filteredRows[0]` + effect דרס `selectedWeek` | `CashflowControlScreen` — שבוע נבחר עצמאי; טווח מורחב לכלול שבוע נבחר |
| RC-3 | יתרת מגירה ₪ ב-AH-141 עם ספירה חלקית | `drawerRemaining*` חושב גם ב-PARTIAL | `week-flow-service` — מגירה/מונה רק ב-**COMPLETE**; PARTIAL → `null` + תווית «ספירה חלקית» |
| RC-4 | $10,900 «נראה כתקבול» | בלבול בין `turkeyClosingUsd` (יתרה מצטברת מ-`TurkeyTransferMovement`) לתקבולי לקוח | UI: הערה ב-`CashflowTurkeyCompact` / five-layer; הסרת fallback `turkeyClosingUsd` בשורת «יתרת סגירה PS» במטריצה |
| RC-5 | PS/IL מפוזרים | סיווג כפול ב-UI/שירותים | SSOT: `cash-flow-track-ssot.ts` — `resolveCashFlowTrack` / `aggregateTrackIntakeFromTotals` |
| RC-6 | השוואת הזמנות שבוע ↔ תקבולים שבוע | `Payment.weekCode` ≠ `intakeDate` (דוגמה AH-145: 4 תשלומים weekCode, 0 קליטה בשבוע) | KPI «הזמנות לגבייה» (N+1), עמודות «לגבייה» / «נוצרו», הקשר ב-`loadFlowWeekContext` |

---

## 2. מקור כל נתון ב-DB (תמצית)

| נתון UI | מקור DB / שירות |
|---------|------------------|
| תקבולים בפועל (שבוע) | `Payment` + `cash-control-flow-receipt-payments.ts` (תאריך קליטה / intake), פילטר פנימי: `cash-control-internal-payments` |
| סיכום ערוצים יומי | `flow-week-financial-ssot` / `weekPaymentIntake` ב-`loadFlowWeek` |
| הזמנות «נוצרו השבוע» | `Order` לפי `weekCode` / scope מדינה |
| הזמנות «לגבייה» | שבוע N+1: `flow-week-due-orders.ts` + טעינה ב-`flow-weeks-overview-service` |
| FX PS/IL | JSON שבוע / `fxPurchases` + `sumFxPurchases` |
| הוצאות | `CashExpense` (scope שבוע) |
| טורקיה — הועבר / יתרה | `TurkeyTransferMovement` + `turkey-transfer-balance-service.ts` |
| פתיחה / סגירה קופות | `weekBalanceSnapshot` / `loadFlowWeekOpeningBalance`, `readCashboxClosing` |
| ספירת מנהל | `ManagerCount` / variance lines — `manager-count-expected-service`, `flow-variance.service` |
| חוב / יתרת זכות לקוח | מנועי לקוחות קיימים (לא שונו) — drill / reconciliation CUSTOMER |

---

## 3. נוסחת KPI (מסך בקרת תזרים)

| KPI | נוסחה / מקור |
|-----|----------------|
| הזמנות לגבייה | סכום/מספר הזמנות משבוע **קודם** (מדיניות N→N+1) — `ordersDue*` על `FlowWeekOverviewRow` |
| תקבולים בפועל | סכום רכיבי intake מאושרים בשבוע (לא מחבר ₪+$); PS/IL מ-`aggregateTrackIntakeFromTotals` |
| יתרת קופת $ / ₪ | מנוע קופות ב-`loadFlowWeek` — **מוצג counted רק אם COMPLETE**; אחרת calculated + סטטוס |
| יתרה לטורקיה | `turkeyClosingUsd` — יתרה מצטברת, לא תקבול שבועי |
| פערים מאומתים | `countVerifiedFlowExceptions` / `verifiedExceptionCount` — רק ספירה מלאה + פער כספי |

---

## 4. מפת סיווג PS / IL

**מימוש:** `src/lib/flow-control/cash-flow-track-ssot.ts`

| מסלול | ערוצים (`CashControlChannel`) |
|-------|----------------------------------|
| **PS** | `CASH_ILS`, `CASH_USD` |
| **IL** | `BANK_TRANSFER_*`, `CREDIT_CARD_*`, `CHECK_*` |
| **UNASSIGNED** | FX, עמלות, העברות פנימיות, method לא מוכר — **לא** מיוחס אוטומטית ל-PS/IL |

תשלום מורכב: סיווג **לכל allocation** דרך `resolveCashFlowTrack(method, currency)` (בדיקת QA: $300 מזומן + $700 העברה → PS $300, IL $700).

FX / עמלות / טורקיה PS·IL: עדיין דרך שדות שבוע / `WEEK_FLOW_LINE_CHANNEL` — הרחבת SSOT לייצוא (`flow-export-build`) — חלקי; יש ליישר בייצוא Excel/PDF בהמשך.

---

## 5. חישובי קופות ₪ / $

**PS — דולר:** פתיחה + מזומן $ + כניסות $ (כולל FX PS) − העברות טורקיה PS − הוצאות $ − יציאות מאומתות.  
**PS — שקל:** פתיחה + מזומן ₪ − FX PS (יציאת ₪) − הוצאות ₪ − יציאות.

**מצב ספירה:** PARTIAL/NONE — אין «יתרת סגירה מאומתת»; אין גלגול אוטומטי כעובדה.  
**גלגול:** `loadFlowWeekOpeningBalance` ← `weekBalanceSnapshot.cashboxClosing` רק כשיש סגירה מאומתת.

---

## 6. חישובי FX

- המרה = תנועה בין מטבעות, **לא** תקבול לקוח חדש.
- PS: `fxPurchaseIls` / `fxPurchaseUsd` (JSON שבוע).
- IL: `ilFxPurchaseIls` (+ מסלול IL ב-`summarizeWeekFxTracks`).
- עמלה: שדות commission נפרדים — לא להפחית פעמיים.

---

## 7. חישובי טורקיה

- **התחייבות / נדרש:** שורות reconciliation `OPEN_OBLIGATION` + תנועות מתוכננות.
- **הועבר בפועל:** `turkeyTransferredUsd` / תנועות מאומתות.
- **יתרה פתוחה / closing:** `turkeyClosingUsd` — מצטבר מ-`TurkeyTransferMovement` (AH-141/145/146: **$10,900.00** — אותה יתרה, לא «תקבול השבוע»).

---

## 8. שיוך שבועות

| מושג | שדה / לוגיקה |
|------|----------------|
| Order Week | `Order.weekCode` |
| Payment Intake Week | תאריך קליטה (`intakeDate`) — SSOT תקבולים |
| Due Week | שבוע N מיועד לגבייה ב-N+1 (`orderWeekForDueCollectionWeek`) |
| Payment.weekCode | נשמר להיסטוריה — **לא** להחליף intake ב-KPI תקבולים |

---

## 9. מניעת כפילויות

- פנימי: `CUSTOMER_CREDIT`, `CREDIT_APPLICATION`, `BALANCE_RESET`, `ADJUSTMENT_FEE`, העברות בין קופות — מסוננים מ-receipt payments.
- UI: לא מחבר ₪+$ בעמודת «סה״כ» במטריצה (מוצג «נפרד»).
- חריגות: ערוצים בלי ספירה = **ממתין לאימות**, לא חריגה כספית.

---

## 10. חריגות מאומתות (מדיניות)

מקור: `buildFlowBusinessReconciliation` + `countVerifiedFlowExceptions`.

- **VERIFIED_EXCEPTION:** ספירה COMPLETE + SHORTAGE/SURPLUS עם count.
- **PENDING_VERIFICATION:** ספירה חסרה/חלקית.
- **OPEN_OBLIGATION:** טורקיה / התחייבות — לא בהכרח «חריגה».
- חוב לקוח — לא אוטומטית חריגת קופה.

---

## 11. קבצים ששונו / נוספו (תזרים)

**חדשים (ליבה):**  
`cash-flow-track-ssot.ts`, `flow-week-due-orders.ts`, `flow-week-business-reconciliation.ts`, `flow-week-five-layer-reconciliation.ts`, `cash-flow-track-ssot.qa.test.ts`, `flow-week-business-reconciliation.qa.test.ts`

**UI:**  
`CashflowControlScreen`, `CashflowPrimaryKpiStrip`, `CashflowWeeksTable`, `CashflowWeekDetailPanel`, `CashflowOverviewMatrix`, `CashflowAnomaliesModal`, `cashflow-cashbox-display.ts`, ועוד רכיבי compact.

**שירותים:**  
`flow-weeks-overview-service`, `week-flow-service`, `manager-count-expected-service`, `flow-types.ts`

**QA:**  
`scripts/cashflow-regression.qa.ts`, `scripts/cashflow-financial-validation.qa.ts` (הערת הרצה עם `register-server-only` shim)

*(קבצים נוספים ב-working tree — documents / flow-persist — מחוץ להיקף תזרים; לא נכללו בתיקון פיננסי.)*

---

## 12. תוצאות AH-139 / AH-141 / AH-145 / AH-146

| שבוע | הזמנות (DB) | קליטה payments | weekCode payments | תקבול $ (intake) | תקבול ₪ | ספירה | drawer ₪ | טורקיה closing $ | verified exceptions |
|------|-------------|----------------|-------------------|------------------|---------|--------|----------|------------------|---------------------|
| AH-139 | 0 | 2 | 10 | 5344 | 7000 | NONE | null | 0.00 | 0 |
| AH-141 | 1 | 2 | 1 | 11000 | 0 | PARTIAL | null | 10900.00 | 0 |
| AH-145 | 8 | 0 | 4 | 0 | 0 | NONE | null | 10900.00 | 0 |
| AH-146 | 1 | 0 | 0 | 0 | 0 | NONE | null | 10900.00 | 0 |

**DB ↔ מסך:** `cashflow-financial-validation.qa.ts` — כל ההשוואות diff=0 (READ-ONLY).  
**Regression:** `cashflow-regression.qa.ts` — PASS (כולל AH-145 intake=0 vs weekCode=4, AH-141 drawer null ב-PARTIAL).

---

## 13. TypeScript ו-Build

| בדיקה | תוצאה |
|--------|--------|
| `npx tsc --noEmit` | PASS (לאחר תיקון `cashflow-cashbox-display`, טיפוסי five-layer) |
| `npm run build` | PASS (Next.js 15.5.15) |

---

## 14. תוצאות QA

| Suite | תוצאה |
|-------|--------|
| `cash-flow-track-ssot.qa.test.ts` | 3/3 PASS |
| `flow-week-business-reconciliation.qa.test.ts` | 2/2 PASS |
| `flow-week-financial-ssot.qa.test.ts` | 2/2 PASS |
| `cashflow-regression.qa.ts` | PASS |
| `cashflow-financial-validation.qa.ts` | PASS (4 שבועות) |
| `npm run qa:all` (אחרון ב-`docs/qa-summary.json`) | 151 pass / **10 fail** — כשלי payment-intake/ledger ידועים; **לא** סומנו כלא רלוונטיים לתזרים; יש לבדוק תלות לפני Production |

**הרצת סקריפטים DB:**  
`node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/cashflow-regression.qa.ts`

---

## 15. סיכונים שנותרו

1. **Legacy UI:** `deriveWeekStatus` / `weekDiffIls` ב-`cashflow-control-helpers.ts` — עדיין עלולים להציג «בעיה» בשורת שבוע ללא קשר ל-reconciliation החדש.
2. **ייצוא Excel/PDF:** לא כל הנתיבים משתמשים ב-`resolveCashFlowTrack` (לבדוק `flow-export-build.ts`).
3. **תשלום מורכב ב-production:** aggregate intake לפי ערוץ יומי — allocations מפורטים per-payment דורשים חיבור ל-`getFlowPaymentContributions` (אם קיים) בכל drill.
4. **IL — זמינות בנק:** אין שדה סליקה מאומת לכל צ'ק/אשראי — UI צריך messaging «נקלט — זמינות בנקאית לא אומתה» (חלקי).
4. **AH-145 weekCode vs intake:** נתון תקין — דורש הדרכת משתמש; לא bug ב-SSOT intake.

---

## 16. פעולות הדורשות אישור

- [ ] Push / Deploy / Production DB writes  
- [ ] Migration או תיקון היסטורי על `Payment` / `TurkeyTransferMovement`  
- [ ] שינוי FIFO, allocations, יתרות לקוח, OrderPaymentBreakdown  
- [ ] החלפת `deriveWeekStatus` הגלובלי ב-UI ישן  
- [ ] הרצת `npm run qa:all` מלא + טיפול ב-10 הכשלים לפני go-live  

---

## 17. אישור — לא בוצעו כתיבות Production

- לא בוצעו עדכוני נתונים היסטוריים, migration, push או deploy במסגרת דוח זה.
- כל בדיקות DB היו **READ-ONLY** (Prisma query + שירותי load).

---

## קריטרион הצלחה — מצב נוכחי

| שאלה | ניתן לענות מהמסך? | הערה |
|------|-------------------|------|
| כמה לקוחות חייבים? | חלקי | drill / reconciliation CUSTOMER — לא שונה מנוע חוב |
| כמה כסף התקבל בפועל? | כן | intake שבוע + פירוט ערוצים |
| PS vs IL? | כן | עמודות PS/IL בטבלה + SSOT |
| מזומן נשאר ₪/$? | כן עם מגבלה | calculated; counted רק COMPLETE |
| FX / טורקיה? | כן | עם הפרדת closing מצטבר |
| פער מחושב vs נספר? | כן | מודל פערים + ספירה |
| גלגול שבוע? | כן עם מגבלה | רק opening מאומת |

---

*דוח זה משלים את שלושת הדוחות הקודמים (Source of Truth Audit, Compact Redesign, Business Reconciliation) ומסמן את יישום Phase A–D המקומי.*
