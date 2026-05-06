# Reports QA

## Scope
- `/admin/reports` dashboard + cards
- report table view
- export (Excel/PDF) אם קיים
- "יתרות לקוחות" (balances) + פילטרים רלוונטיים

## Conventions
- **STATUS**: Not Run | Pass | Fail | Blocked
- **TC-ID format**: `REP-XXX`

---

## Filters + Sync

### REP-001
**TITLE:** שינוי dateFrom/dateTo מסנכרן workWeek או מנקה אותו (—)
**STEPS:**
1. פתח `/admin/reports`.
2. קבע תאריכים לטווח 01/05/2026–15/05/2026.
3. בדוק שדה שבוע עבודה.
4. קבע תאריכים לטווח 03/05/2026–09/05/2026.
**EXPECTED RESULT:**
- טווח > שבוע → workWeek מתרוקן/—.
- טווח מדויק שבוע → workWeek = AH-119.
**ACTUAL RESULT:**
**STATUS:** Not Run

### REP-002
**TITLE:** שינוי workWeek מעדכן dateFrom/dateTo לטווח השבוע
**STEPS:**
1. פתח `/admin/reports`.
2. הזן workWeek=AH-118.
**EXPECTED RESULT:**
- dateFrom/dateTo מתעדכנים ל־26/04/2026–02/05/2026.
**ACTUAL RESULT:**
**STATUS:** Not Run

---

## Totals + Calculations

### REP-101
**TITLE:** KPI cards נטענים ללא שגיאות והמספרים עקביים עם הטבלה
**STEPS:**
1. בחר פילטרים.
2. המתן לטעינה.
3. פתח דוח אחד.
**EXPECTED RESULT:**
- אין שגיאות קונסול.
- totals בטבלה תואמים לסכומים שמוצגים (בגבולות עיגול).
**ACTUAL RESULT:**
**STATUS:** Not Run

### REP-102
**TITLE:** "יתרות לקוחות" לא מציג לקוחות עם יתרה 0.00 אחרי עיגול
**STEPS:**
1. פתח מסך/דוח יתרות.
2. בדוק שלקוחות עם 0.00 לא מופיעים.
**EXPECTED RESULT:**
- רק לקוחות עם יתרה ≠ 0.00 מוצגים.
**ACTUAL RESULT:**
Seed: נוספו `QA-REPORT-ZERO` (הזמנה 1,000 ₪ + תשלום מלא → יתרה 0) ו־`QA-REPORT-OPEN` (הזמנה 5,000 ₪ + תשלום 2,000 ₪ → יתרה 3,000 ₪), שבוע `AH-119`, תאריך 2026-05-05.  
Playwright (`tests/qa/reports-balances.spec.ts`): בטווח `2026-05-01`–`2026-05-31` + `week=AH-119` — בטבלת הדוח **אין** את `QA-REPORT-ZERO`, **כן** מופיעה שורת `QA-REPORT-OPEN` עם עמודות 5,000 / 2,000 / 3,000 ₪ (he-IL), ובאזור הסיכום **אין** את שם הלקוח עם יתרה 0. (הסיכום הכולל משקף את כל הלקוחות עם יתרה ≠ 0 בטווח, לא רק את שורת ה-QA.)
**STATUS:** Pass

---

## Export

### REP-201
**TITLE:** Excel export יורד ומכיל נתונים
**STEPS:**
1. בחר דוח.
2. לחץ "Excel".
3. פתח קובץ.
**EXPECTED RESULT:**
- ירידה מצליחה (200).
- קובץ נפתח ומכיל headers + rows.
**ACTUAL RESULT:**
**STATUS:** Not Run

### REP-202
**TITLE:** PDF export/print פועל ללא שגיאות
**STEPS:**
1. בחר דוח.
2. לחץ "PDF".
**EXPECTED RESULT:**
- חלון חדש/print נפתח.
- אין שגיאות קונסול.
**ACTUAL RESULT:**
**STATUS:** Not Run

---

## Edge cases

### REP-901
**TITLE:** פילטרים ריקים לא שוברים את המסך
**STEPS:**
1. נקה את כל הפילטרים האפשריים.
2. רענן דף.
**EXPECTED RESULT:**
- אין קריסה.
- יש defaults עקביים.
**ACTUAL RESULT:**
**STATUS:** Not Run

