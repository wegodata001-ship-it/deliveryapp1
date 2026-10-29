# CUSTOMER 101 — FINANCIAL RECONCILIATION AUDIT

**לקוח:** חליל · קוד **101** · `customerId` `a5bf8da6-9c3d-4323-93ea-1fcf6a771797`  
**תאריך אודיט:** 2026-10-29  
**מצב:** READ-ONLY — **0 כתיבות DB** (לא הורצו migration / איפוס / תיקון נתונים)

**מקורות אודיט:**

- `scripts/.tmp-101-full-payment-reconciliation-audit.ts` → JSON
- `scripts/.tmp-101-intake-remaining-forensic-audit.ts` → JSON
- `src/lib/khalil-three-screen.qa.test.ts` (לוגיקה)
- DB חי (Supabase) דרך Prisma

---

## 1. תשובות ישירות לשאלות הדוח

| שאלה | ממצא מאומת |
|------|------------|
| **מה החוב האמיתי של חליל כרגע?** | **$601.00** — `getCustomerAccountBalances` + `buildCustomerAccountLedger` בחתך **CURRENT** (TURKEY). |
| **$601 / $524.33 / אחר?** | **$601** = חוב נטו לגבייה **CURRENT** לפני תשלום בטופס. **$524.33** = **PREVIEW** אחרי תשלום טיוטה **$76.67** (`601 − 76.67`). זה לא חוב שמור — רק תחזית. |
| **למה ההזמנות מציגות ~$2,308?** | **$2,384.83** = סכום `dbRemainingUsd` להזמנות eligible בשבוע קליטה **AH-145** (WEEK SCOPED). **$2,308.16** = **$2,384.83 − $76.67** — אותו מספר אחרי הורדת תשלום הטופס **בלי** cap ל-CURRENT. |
| **למה אמצעי תשלום $2,384.83?** | סיכום **מתוכנן/נותר** מ-`OrderPaymentBreakdown` (PMC) — **תכנון**, לא CURRENT SSOT. |
| **מקור $76.67?** | סכום התשלום **בטופס** (טיוטה) בקליטה — לא רשומה ב-DB עד שמירה. |
| **הקצאות חסרות?** | TR-140-0001: פער breakdown מול תשלומים (657.73+616.1 PMC vs 1273.83 order remaining; breakdown stale מ-10/2025). TR-P-000027: $758.01 חוב + $41.99 עמלה מ-$800. |
| **יתרת זכות שלא נוצלה?** | **CURRENT:** available credit **$0** (exclusive books). **גross** credit היסטורי ~**$2,793.83** נוצר; **~$1,783.83** כבר משוקף בפער WEEK vs CURRENT (`2384.83 − 601`). |
| **איפוסים קודמים?** | TR-P-000026/027 cluster ($800 adjustment path). עמלות: **commission balance $1,040.49** (CURRENT SSOT). |
| **מה לתקן?** | **קוד (לא נתונים):** איחוד תצוגה — balance reset / «יתרת הזמנות פתוחה» / PMC חייבים להשתמש ב-**netCollectibleUsd** + FIFO cap, לא ב-Σ week `dbRemaining` גולמי. תיוג CURRENT vs WEEK vs PREVIEW. |

---

## 2. סיכומי SSOT (CURRENT — מקור אמת לגבייה)

| מדד | USD | מקור |
|-----|-----|------|
| Total orders (chargeable) | 20,048.50 | `customer-account-balances` |
| Total debt payments | 16,653.67 | payments ACTIVE, לא credit-only |
| **Open debt (collectible)** | **601.00** | FIFO + exclusive books |
| Available credit | 0.00 | exclusive |
| Net balance | −601.00 | debt לגבייה |
| Commission balance | 1,040.49 | commission ledger SSOT |
| Snapshot `customer.balanceUsd` | −3,394.83 | **מיושן** (updated 2026-08-26) — **לא SSOT** |

---

## 3. שלושה מספרים על המסך — אותה מתמטיקה, scopes שונים

```
WEEK SCOPED (AH-145 eligible orders):  Σ dbRemainingUsd     = 2,384.83
CURRENT SSOT (FIFO collectible):       openDebtUsd          =   601.00
Planning gap (credit already in books): 2384.83 − 601       = 1,783.83

Draft payment in form:                                      =    76.67
PREVIEW net after draft:           601 − 76.67              =   524.33
WEEK minus draft (wrong for reset): 2384.83 − 76.67        = 2,308.16
PMC remaining (planning):                                   = 2,384.83
```

**מסקנה:** הסתירה **מוסברת** כערבוב **CURRENT** / **WEEK SCOPED** / **PREVIEW** / **POSTED**. הנוסחה `$601 − $76.67 = $524.33` ו-`$2,384.83 − $76.67 = $2,308.16` **מאומתת** — לא מקרית.

---

## 4. טבלת Reconciliation — הזמנות (AH-145 intake eligible)

| הזמנה | שבוע | סכום כולל | עמלה | שולם (חוב) | יתרה אחרי תשלומים | dbRemaining intake | PMC נותר (שיטות) | הערה |
|--------|------|-----------|------|------------|---------------------|--------------------|------------------|------|
| TR-137-0001 | AH-134 | 6,514.50 | — | 6,514.50 | 0 | 0 | — | סגור |
| TR-134-0006 | AH-134 | 4,292.50 | — | 4,292.50 | 0 | 0 | — | סגור |
| TR-134-0012 | AH-134 | 252.50 | — | 252.50 | 0 | 0 | — | סגור |
| **TR-140-0001** | AH-140 | **6,868.00** | 68 | **5,594.17** | **1,273.83** | **1,273.83** | ~1,273.83 (657.73+616.1) | partial; breakdown ישן |
| **TR-145-0001** | AH-145 | **1,010.00** | 10 | 0 | **1,010.00** | **1,010.00** | 1,010 CASH | unpaid |
| **TR-145-0003** | AH-145 | **101.00** | 1 | 0 | **101.00** | **101.00** | 101 CASH | unpaid |
| TR-146-0001 | AH-146 | 1,010.00 | — | 0 | 1,010.00 | — | — | **לא ב-week AH-145** |

**Σ dbRemaining (6 שורות eligible):** 1,273.83 + 1,010 + 101 = **2,384.83**

**למה שלוש ההזמנות «פתוחות» למרות CURRENT $601?**  
ברמת **הזמנה** `dbRemainingUsd` הוא יתרה **לפני** cap ברמת **לקוח** (credit FIFO שכבר הוריד collectible ל-$601). CURRENT SSOT מציג **$601**; WEEK SCOPED מציג **$2,384.83** — **שניהם נכונים בחתך שונה**, אבל **אסור** להציג WEEK כ«חוב לפני איפוס» בלי cap.

*(במפרט צוין TR-140-0001 $1,197.16 — ב-DB נכון ל-29/10: total $6,868, remaining **$1,273.83**, לא $1,197.16.)*

---

## 5. סיכומי Reconciliation

| סיכום | USD | הערה |
|--------|-----|------|
| Total orders (due) | 20,048.50 | CURRENT scope |
| Total actual payments (debt) | 16,653.67 | excludes cancelled |
| Gross remaining before customer FIFO | 3,394.83 | order math |
| **Net collectible (CURRENT)** | **601.00** | SSOT |
| Week scoped order remaining | 2,384.83 | AH-145 intake |
| Planned open (PMC) | 2,384.83 | breakdown rows |
| Credit created (historical) | 2,793.83 | CUSTOMER_CREDIT payments |
| Credit available CURRENT | 0 | exclusive |
| Commission balance | 1,040.49 | |

---

## 6. מפת SSOT / scopes (חובה ליישום אחיד)

| Scope | שימוש | קובץ מרכזי |
|-------|--------|------------|
| **CURRENT** | יתרות לקוח, כרטסת, dashboards | `customer-account-balances.ts`, `customer-account-ledger.ts` |
| **WEEK SCOPED** | הזמנות eligible בקליטה | `payment-intake-load.ts`, `payment-intake-order-filter.ts` |
| **BEFORE PAYMENT (preview)** | `buildPaymentPreview`, `netCollectible − draft` | `payment-intake-preview.ts` |
| **PLANNED (PMC)** | אמצעי תשלום מתוכננים | `payment-intake-planning-views.ts`, `OrderPaymentBreakdown` |
| **POSTED** | אחרי save payment | DB `Payment` + allocations |

**קיים:** `customer-collectible-reconciliation.ts` — `resolveNetCollectibleUsd`, `buildCustomerCollectibleReconciliation`.  
**חסר ב-UI:** balance reset / KPI «יתרת הזמנות» / חלק מ-PMC עדיין על WEEK/PLANNED גולמי.

---

## 7. Root causes — קובץ / פונקציה

| # | תופעה | שורש | קובץ |
|---|--------|------|------|
| RC-1 | איפוס ~$2,308 | `totalShortfallUsd` מסכם **per-order** shortfall על **totalAmountUsd** vs paid+alloc — על **כל** eligible orders, לא capped ב-$601 | `balance-reset-calculation.ts` `computeOrderBalanceResetRows`, `PaymentModalUpdated.tsx` |
| RC-2 | «חוב לפני תשלום» $2,384.83 | `totalDebtBeforePaymentUsd = weekScopedRemainingUsd` | `PaymentModalUpdated.tsx` ~1170–1180 |
| RC-3 | PMC $2,384.83 | `remaining` מ-breakdown / method views | `payment-intake-planning-views.ts` |
| RC-4 | $524 vs $601 | preview משתמש ב-**netCollectible** (נכון) | `payment-intake-preview.ts` + `resolveNetCollectibleUsd` |
| RC-5 | snapshot −3394.83 | `customer.balanceUsd` לא מסונכרן | לא להשתמש בכרטיס |
| RC-6 | TR-140 breakdown | `remainingAmount` stale (2026-10-01) vs paid TR-P-000027 | `OrderPaymentBreakdown` |

---

## 8. איפוס יתרה — מה חייב להשתנות (קוד בלבד, אחרי אישור)

לפני איפוס להציג:

1. Gross open orders (week): **$2,384.83**
2. CURRENT net collectible: **$601.00**
3. Credit / FIFO adjustment: **$1,783.83**
4. Draft payment: **$76.67**
5. Net before reset: **$524.33**
6. **Max reset eligible:** capped at net collectible / allocated preview — **לא $2,308.16**

---

## 9. אמצעי תשלום מתוכננים

- **לא** יוצרים חוב DB נוסף — הם **תכנון** מ-breakdown.
- **$2,384.83** = planned remaining על שורות עם `remaining > 0.01` — **תואם** Σ week orders, **לא** CURRENT $601.
- PS/IL: CASH $1,727.10 + BANK $657.73 ≈ PMC filter (שבוע AH-145).

---

## 10. בדיקות שבוצעו

| בדיקה | תוצאה |
|--------|--------|
| `full-payment-reconciliation-audit` | PASS (JSON) |
| `intake-remaining-forensic-audit` | PASS (JSON) |
| `khalil-three-screen` (unit) | CURRENT books = ledger; FIFO invariant |
| DB writes | **0** |

---

## 11. פעולות — דורשות אישור

| שלב | פעולה |
|-----|--------|
| **A (הושלם)** | Audit READ-ONLY + דוח זה |
| **B** | תיקון קוד: balance reset + labels + PMC KPI cap (`netCollectibleUsd`) |
| **C** | בדיקות: `customer-collectible-reconciliation.test.ts`, `khalil-three-screen`, 12 תרחישי spec |
| **D** | נתונים: reconcile TR-140 breakdown **רק** אחרי preview + אישור (לא אוטומטי) |

---

## 12. הצהרה

**לא בוצעו:** עדכוני DB, איפוס יתרה, migration, תשלומים פיקטיביים, push production.

**הבעיה לא «תוקנה» end-to-end** — **אובחנה**; תיקון לוגיקה ממתין ליישום שלב B.
