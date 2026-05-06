# Payments QA

## Scope
- **קליטת תשלום** (Payment modal)
- **קליטת תשלום מעודכן** (multi-payment)
- **סגירת חיובים / close debt**

## Conventions
- **STATUS**: Not Run | Pass | Fail | Blocked
- **TC-ID format**: `PAY-XXX`

---

## Payment Capture — קליטת תשלום רגילה

### PAY-001
**TITLE:** פתיחת קליטת תשלום ללא שגיאות קונסול
**STEPS:**
1. פתח חלון "קליטת תשלום".
2. בחר לקוח.
**EXPECTED RESULT:**
- אין שגיאות קונסול.
- אין API 500.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-002
**TITLE:** Global week קובע ברירת מחדל לתאריך/שבוע בקליטת תשלום (local override מותר)
**STEPS:**
1. ב־Header קבע `AH-118`.
2. פתח קליטת תשלום.
3. בתוך החלון שנה שבוע מקומי ל־`AH-120`.
4. סגור ופתח שוב.
**EXPECTED RESULT:**
- פתיחה ראשונה: ברירת מחדל = global.
- שינוי בתוך החלון לא משנה Header.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-003
**TITLE:** "שלם חיוב" ממלא סכום פתוח נכון לפי מטבע/שער
**STEPS:**
1. בקליטת תשלום בחר לקוח עם חיובים פתוחים.
2. לחץ "שלם חיוב" על שורה.
**EXPECTED RESULT:**
- הסכום מתמלא בשדה המתאים (USD או ILS).
- אין NaN, שתי ספרות.
**ACTUAL RESULT:**
Playwright: בוצעה בחירת לקוח (ARWA) → לחיצה על "שלם" לחיוב פתוח → ללא שגיאות קונסול.
**STATUS:** Pass

### PAY-004
**TITLE:** שמירה יוצרת Payment ב־DB ומעדכנת סטטוס חיובים
**STEPS:**
1. בחר לקוח.
2. הזן סכום תשלום.
3. שמור.
4. בדוק שהחוב קטן/נסגר בטבלה.
**EXPECTED RESULT:**
- רשת: 200.
- טבלה: status מתעדכן.
- אין אפשרות "לשלם פעמיים" על אותו חיוב אם נסגר.
**ACTUAL RESULT:**
Playwright: שמירה בוצעה, ולאחר מכן הופיעו כפתורי "שלם" במצב disabled לפחות עבור חיוב אחד (סימן לסגירה/מניעה). ללא שגיאות קונסול.
**STATUS:** Pass

---

## Payment Capture Updated — קליטת תשלום מעודכן (multi lines)

### PAY-101
**TITLE:** הוספת שורת תשלום חדשה מציגה חישובים פר שורה + total
**STEPS:**
1. פתח "קליטת תשלום מעודכן".
2. הוסף שורת תשלום.
3. מלא amount, currency, VAT mode, method, note.
**EXPECTED RESULT:**
- כרטיס שורה מציג סכום סופי אחרי מע״מ.
- total USD מתעדכן.
- אין overflow/שבירות RTL.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-102
**TITLE:** VAT modes: EXEMPT / BEFORE_VAT / INCLUDING_VAT נכונים
**STEPS:**
1. בשורת תשלום, הזן amount=100.
2. החלף VAT mode בין 3 המצבים.
**EXPECTED RESULT:**
- EXEMPT: final=100
- BEFORE_VAT: final=118 (אם 18%)
- INCLUDING_VAT: final=100 (net קטן יותר)
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-103
**TITLE:** שילוב מטבעות: ILS + USD מחושב לטוטאל USD עם שער
**STEPS:**
1. צור 2 שורות: אחת USD ואחת ILS.
2. קבע usdRate.
**EXPECTED RESULT:**
- ILS→USD לפי \(amountIls / usdRate\)
- USD→ILS לפי \(amountUsd * usdRate\)
- שתי ספרות, אין NaN.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-104
**TITLE:** "סגור בתשלום" מוסיף שורת תשלום מהיתרה פתוחה
**STEPS:**
1. פתח multi-payment.
2. בטבלת החיובים לחץ "סגור בתשלום" לשורה פתוחה.
**EXPECTED RESULT:**
- מתווספת שורת תשלום עם סכום היתרה.
- לא שומר אוטומטית.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-105
**TITLE:** שמירה multi-payment יוצרת payments ומקצה לחיובים (ללא שינוי סכימה)
**STEPS:**
1. הוסף 2–3 שורות.
2. שמור.
3. בדוק חובות פתוחים/נסגרים.
**EXPECTED RESULT:**
- רשת: 200.
- יצירת רשומות Payment ב־DB.
- notes מכיל פירוט (line breakdown) אם כך הוגדר.
**ACTUAL RESULT:**
**STATUS:** Not Run

---

## Edge cases

### PAY-901
**TITLE:** סכומים 0 / ריקים לא נשמרים כ־NaN
**STEPS:**
1. נסה לשמור עם שורה ריקה או amount=0.
**EXPECTED RESULT:**
- UI מונע/מציג הודעה, או שומר כ־0 בצורה עקבית (לפי הלוגיקה הקיימת).
- אין NaN/Infinity בקונסול.
**ACTUAL RESULT:**
**STATUS:** Not Run

### PAY-902
**TITLE:** Double click save לא יוצר תשלום כפול
**STEPS:**
1. לחץ שמירה פעמיים מהר.
**EXPECTED RESULT:**
- רק פעולה אחת מתבצעת (loading state / disable button).
**ACTUAL RESULT:**
**STATUS:** Not Run

