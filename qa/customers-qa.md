# Customers QA

## Scope
- Customer card window (פרטי לקוח / כרטסת לקוח)
- Ledger interactions (פתיחת הזמנה/תשלום)
- balances + status badges

## Conventions
- **STATUS**: Not Run | Pass | Fail | Blocked
- **TC-ID format**: `CUS-XXX`

---

### CUS-001
**TITLE:** פתיחת כרטסת לקוח מתוך טבלה (לינק לקוח) ללא שגיאות
**STEPS:**
1. פתח רשימת הזמנות/בקרת תקבולים.
2. לחץ על שם לקוח (פתיחת כרטסת).
**EXPECTED RESULT:**
- חלון נפתח.
- אין שגיאות קונסול.
**ACTUAL RESULT:**
**STATUS:** Not Run

### CUS-002
**TITLE:** טאבים: פרטי לקוח / כרטסת לקוח עובדים ומציגים מידע
**STEPS:**
1. בחלון לקוח, עבור בין טאבים.
**EXPECTED RESULT:**
- תוכן מתחלף בלי layout jump חריג.
**ACTUAL RESULT:**
**STATUS:** Not Run

### CUS-003
**TITLE:** שורות בכרטסת ניתנות ללחיצה ופותחות תשלום/עריכת הזמנה בהתאם
**STEPS:**
1. פתח כרטסת.
2. לחץ על שורה שמייצגת תשלום.
3. לחץ על שורה שמייצגת הזמנה.
**EXPECTED RESULT:**
- תשלום: נפתח חלון קליטת תשלום.
- הזמנה: נפתחת עריכה/חלון מתאים.
**ACTUAL RESULT:**
**STATUS:** Not Run

### CUS-004
**TITLE:** יתרות/סטטוסים בכרטסת מוצגים נכון (חוב/שולם)
**STEPS:**
1. פתח כרטסת עם מספר פריטים.
2. ודא באדג'ים/סטטוס.
**EXPECTED RESULT:**
- סטטוסים עקביים עם נתוני DB.
**ACTUAL RESULT:**
**STATUS:** Not Run

### CUS-005
**TITLE:** עריכת לקוח (מודל עריכה) שמירה + רענון נתונים
**STEPS:**
1. פתח כרטסת.
2. לחץ "עריכת לקוח".
3. שנה שדה ושמור.
4. סגור/פתח מחדש כרטסת.
**EXPECTED RESULT:**
- DB מתעדכן.
- UI מציג ערכים חדשים.
**ACTUAL RESULT:**
**STATUS:** Not Run

