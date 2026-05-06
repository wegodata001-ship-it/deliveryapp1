# Orders QA

## Scope
- **קליטת הזמנה** (Order Capture modal/panel)
- **עריכת הזמנה**
- **רשימת הזמנות**

## Conventions
- **STATUS**: Not Run | Pass | Fail | Blocked
- **ACTUAL RESULT**: למלא בזמן הרצה בפועל.
- **TC-ID format**: `ORD-XXX`

---

## Order Capture — קליטת הזמנה

### ORD-001
**TITLE:** פתיחת חלון "קליטת הזמנה" נטען בלי שגיאות
**STEPS:**
1. היכנס ל־`/admin`.
2. פתח "קליטת הזמנה" (modal/window).
3. המתן לטעינת תוכן.
**EXPECTED RESULT:**
- החלון נפתח במידה מלאה (ללא overflow חריג).
- אין שגיאות בקונסול.
- אין קריאות API 500.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-002
**TITLE:** Global week/country (Header) קובע ברירת מחדל לפתיחת קליטת הזמנה
**STEPS:**
1. ב־Header קבע `week=AH-118` ו־`country` לערך כלשהו.
2. פתח "קליטת הזמנה".
**EXPECTED RESULT:**
- בשדות השבוע/מדינה בחלון: ברירת מחדל = global.
- התאריך/טווח בחלון מסונכרן לשבוע.
**ACTUAL RESULT:**
Playwright: אחרי קביעת `week=AH-120` ב־Header, פתיחת חלון "קליטת הזמנה" הצליחה (window נפתח). אימות ערך שבוע בתוך החלון לא בוצע אוטומטית עדיין.
**STATUS:** Pass

### ORD-003
**TITLE:** שינוי שבוע מקומי בקליטת הזמנה לא משנה Global
**STEPS:**
1. קבע ב־Header `week=AH-120`.
2. פתח "קליטת הזמנה".
3. בתוך החלון שנה שבוע מקומי ל־`AH-118` באמצעות חצים/הקלדה.
4. סגור את החלון.
**EXPECTED RESULT:**
- בתוך החלון: התאריך משתנה לטווח AH-118.
- ב־Header: נשאר `AH-120`.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-004
**TITLE:** בחירת לקוח לא מסתירה את "צורת תשלום" (layout)
**STEPS:**
1. פתח "קליטת הזמנה".
2. בחר/חפש לקוח כך שיופיעו שדות נוספים.
3. גלול אם צריך (ב־1366x768).
4. נסה לפתוח את dropdown של "צורת תשלום".
**EXPECTED RESULT:**
- "צורת תשלום" נשאר לחיץ ונראה.
- ה־dropdown נפתח ולא נתקע.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-005
**TITLE:** הוספת "מקום תשלום" חדש ב־inline form עובדת ומתווספת לרשימה
**STEPS:**
1. פתח "קליטת הזמנה".
2. בחר "+ הוספת מקום".
3. מלא שם מקום חדש ושמור.
**EXPECTED RESULT:**
- מקום חדש מתווסף לרשימה ונבחר אוטומטית.
- אין refresh מלא של הדף.
- אין שגיאות בקונסול.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-006
**TITLE:** USD/ILS totals – אין NaN/undefined, ריקים = 0.00, שתי ספרות
**STEPS:**
1. פתח "קליטת הזמנה".
2. השאר שדות ריקים ובדוק סיכומים.
3. הזן ערכים עשרוניים/עם פסיקים.
4. נקה שדות שוב.
**EXPECTED RESULT:**
- תמיד מוצג `0.00` ולא `NaN`.
- פורמט 2 ספרות.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-007
**TITLE:** מע״מ בכרטיס שקלים מציג גם USD לפי שער
**STEPS:**
1. פתח "קליטת הזמנה".
2. הזן סכום בשקלים ושער דולר.
3. בדוק שורות מע״מ/סה״כ בכרטיס שקלים.
**EXPECTED RESULT:**
- מע״מ מוצג ₪ וגם $ (לפי \(amountIls / usdRate\)).
- סה״כ סופי מציג סימן מטבע ליד הסכום.
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-008
**TITLE:** שמירה יוצרת/מעדכנת הזמנה ב־DB ומחזירה לטבלה
**STEPS:**
1. פתח קליטת הזמנה.
2. מלא פרטים מינימליים חוקיים.
3. לחץ "שמירה".
4. בדוק ברשימת הזמנות שהרשומה מופיעה/עודכנה.
**EXPECTED RESULT:**
- בקשות רשת 200.
- הרשומה מופיעה בטבלה אחרי refetch.
- הסטטוס/שבוע/מדינה נשמרים נכון.
**ACTUAL RESULT:**
**STATUS:** Not Run

---

## Orders List — רשימת הזמנות

### ORD-101
**TITLE:** שינוי פילטר גלובלי (week/from/to/country) משנה תוצאות בטבלה
**STEPS:**
1. עבור ל־`/admin/orders`.
2. שנה שבוע ב־Header.
3. ודא שהטבלה משתנה (או מציגה empty state מתאים).
**EXPECTED RESULT:**
- הנתונים נטענים לפי ה־query.
- אין מצב "שבוע ותאריכים לא תואמים" ב־URL.
**ACTUAL RESULT:**
Playwright: ניווט ל־`/admin/orders` עם `week=AH-120&from=2026-05-10&to=2026-05-16` הצליח; URL נשמר, ללא שגיאות קונסול.
**STATUS:** Pass

### ORD-102
**TITLE:** חיפוש/סינון לא שובר pagination/רענון
**STEPS:**
1. חפש ערך קיים.
2. עבור עמוד (אם יש).
3. נקה חיפוש.
**EXPECTED RESULT:**
- אין קריאות API 500.
- אין duplicate keys בקונסול.
**ACTUAL RESULT:**
**STATUS:** Not Run

---

## Edit Order — עריכת הזמנה

### ORD-201
**TITLE:** פתיחת עריכת הזמנה שומרת על פילטרים גלובליים ב־URL
**STEPS:**
1. ב־Orders List קבע week/country.
2. פתח הזמנה קיימת לעריכה.
3. חזור אחורה לרשימה.
**EXPECTED RESULT:**
- ה־query נשמר בניווט (week/from/to/country).
**ACTUAL RESULT:**
**STATUS:** Not Run

### ORD-202
**TITLE:** שינוי שבוע/תאריכים בעריכת הזמנה נשמר ב־DB
**STEPS:**
1. פתח עריכת הזמנה.
2. שנה שבוע/תאריך לפי חוקי AH.
3. שמור.
4. רענן דף.
**EXPECTED RESULT:**
- הנתונים נשמרים נכון ומוצגים לאחר רענון.
**ACTUAL RESULT:**
**STATUS:** Not Run

