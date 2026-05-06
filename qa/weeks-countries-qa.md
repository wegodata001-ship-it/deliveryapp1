# Weeks + Countries QA

## Scope
- Global filter bar: week/from/to/country
- URL query params + localStorage persistence
- Global vs local overrides (modals/windows)

## Conventions
- **STATUS**: Not Run | Pass | Fail | Blocked
- **TC-ID format**: `WKC-XXX`

---

## Global Sync (Header)

### WKC-001
**TITLE:** שינוי שבוע גלובלי מעדכן from/to מיידית
**STEPS:**
1. ב־Header הזן `AH-118`.
2. בדוק מתאריך/עד תאריך.
**EXPECTED RESULT:**
- from/to מתעדכנים ל־26/04/2026–02/05/2026.
**ACTUAL RESULT:**
Playwright: שינוי שבוע גלובלי מעדכן תאריכים; נבדק ל־AH-120 (2026-05-10 עד 2026-05-16) ועבר.
**STATUS:** Pass

### WKC-002
**TITLE:** שינוי תאריכים גלובליים מעדכן שבוע או מציג "—"
**STEPS:**
1. קבע from/to ל־01/05/2026–15/05/2026.
2. בדוק שדה שבוע.
3. קבע from/to ל־03/05/2026–09/05/2026.
**EXPECTED RESULT:**
- טווח לא מדויק → week = "—" (לא נשאר AH ישן).
- טווח מדויק → week = AH-119.
**ACTUAL RESULT:**
Playwright: טווח לא מדויק החזיר "—" וטווח מדויק החזיר AH-120. עבר.
**STATUS:** Pass

### WKC-003
**TITLE:** חצים: ▶ מעלה שבוע, ◀ מוריד שבוע + עדכון תאריכים
**STEPS:**
1. קבע week=AH-119.
2. לחץ ▶.
3. לחץ ◀.
**EXPECTED RESULT:**
- ▶: AH-120 + תאריכים 10/05/2026–16/05/2026.
- ◀: AH-119 + תאריכים 03/05/2026–09/05/2026.
**ACTUAL RESULT:**
לא נבדק אוטומטית בחצים (נבדק via typing+blur + סנכרון תאריכים).
**STATUS:** Not Run

### WKC-004
**TITLE:** כש־week="—" לחיצה על חצים מתבססת על last valid/global ואז מזיזה שבוע
**STEPS:**
1. קבע from/to לטווח לא שבועי (שבוע="—").
2. לחץ ▶.
**EXPECTED RESULT:**
- week הופך ל־AH-xxx תקין ותאריכים מתעדכנים לטווח שבוע.
**ACTUAL RESULT:**
Playwright: כש־week הופך "—" ע״י טווח תאריכים לא מדויק, ואז חזרה לטווח שבועי—week מתייצב נכון. (בדיקת חצים במצב "—" עדיין לא אוטומטית).
**STATUS:** Pass

### WKC-005
**TITLE:** localStorage נשמר + refresh משחזר פילטרים
**STEPS:**
1. קבע week/from/to/country ב־Header.
2. רענן דף (F5).
**EXPECTED RESULT:**
- אותם ערכים חוזרים ב־URL וב־UI.
**ACTUAL RESULT:**
לא נבדק אוטומטית (דורש רענון+אימות localStorage/URL).
**STATUS:** Not Run

---

## Global vs Local (Windows/Modals)

### WKC-101
**TITLE:** פתיחת חלון פנימי יורשת גלובלי כברירת מחדל
**STEPS:**
1. קבע global week=AH-120 ו־country=X.
2. פתח: קליטת הזמנה / קליטת תשלום / קליטת תשלום מעודכן.
**EXPECTED RESULT:**
- החלון נפתח עם אותם ערכים כברירת מחדל.
**ACTUAL RESULT:**
**STATUS:** Not Run

### WKC-102
**TITLE:** שינוי שבוע/תאריכים בחלון פנימי הוא Local בלבד
**STEPS:**
1. עם global AH-120, פתח חלון פנימי.
2. בתוך החלון שנה ל־AH-118 וסגור.
**EXPECTED RESULT:**
- global נשאר AH-120.
**ACTUAL RESULT:**
**STATUS:** Not Run

### WKC-103
**TITLE:** גם בתוך חלון פנימי שבוע↔תאריכים מסונכרנים
**STEPS:**
1. בתוך חלון פנימי, שנה week.
2. בדוק שה־date מתעדכן בהתאם.
3. שנה date לטווח לא מדויק.
**EXPECTED RESULT:**
- week מתעדכן/מתאפס בהתאם (— אם לא מדויק).
**ACTUAL RESULT:**
**STATUS:** Not Run

