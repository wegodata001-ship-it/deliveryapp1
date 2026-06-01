# ביצועי מסך התחברות (`/admin-login`)

## סיכום מהיר

| שלב | זמן טיפוסי (לוג) | הערה |
|-----|------------------|------|
| `auth.verifySessionToken` | ~2–20ms | תקין |
| `auth.getSessionPayload` / `getCurrentUser` | ~10–90ms | תקין |
| **`○ Compiling /admin-login`** | **~4s ב-dev** | **צוואר הבקבוק העיקרי** |
| `GET /admin-login` כולל | ~5–6s ב-dev | רוב הזמן = קומפילציה, לא auth |

**מסקנה:** אין פער בין auth ל-request — ה-request הארוך נובע בעיקר מ-**Next.js Dev Mode** שמקמפל את ה-route בכל כניסה ראשונה.

---

## מה נבדק

### Middleware
- `middleware.ts` רץ **רק** על `/admin/:path*` (`matcher`).
- **`/admin-login` לא עובר middleware** — אין `verifySessionToken` כפול מה-middleware בדף login.

### שליחת טופס (שגיאה / הצלחה)

- **לפני:** `useActionState` + Server Action → רענון RSC מלא של דף login אחרי כל ניסיון (השגיאה מופיעה רק אחרי `login.page` מחדש).
- **אחרי:** `POST /api/auth/login` (JSON) — **ללא** רענון דף login במקרה כשל.

**במקרה כשל — רק:**
1. `login.findUser` — `prisma.user.findFirst` (שדות מינימליים)
2. `login.verifyPassword` — `bcrypt.compare` (רק אם המשתמש קיים ופעיל)

**לא רצים במקרה כשל:** `login.createSession`, `getCurrentUser`, dashboard, `lastLoginAt` update.

**Timers:**
```
login.total
login.findUser
login.verifyPassword   ← רק אם נמצא משתמש
login.createSession    ← רק בהצלחה
```

### Redirects

### Imports כבדים (תוקן)
- לפני: `page.tsx` ייבא `getCurrentUser` מ-`admin-auth` → משך את **כל שרשרת Prisma** ל-bundle של דף login → קומפילציה איטית.
- אחרי: `hasValidAdminSession` מ-`session.ts` בלבד (jose + cookies).

---

## Performance logs

בסביבת dev / `DEBUG_PERF_LOGS=1`:

```
[perf] login.session
[perf] login.searchParams
[perf] login.page
[perf] login.api.POST
[perf] login.total / login.findUser / login.verifyPassword / login.createSession
```

גם `console.time` / `timeEnd` דרך `withPerfTimer` ב-`src/lib/perf-log.ts`.

---

## יעדי ביצועים (Production)

| מדד | יעד |
|-----|-----|
| auth (JWT) | < 100ms |
| render שרת | < 300ms |
| **סה״כ GET** | **< 1s** |

ב-**Development** זמן קומפילציה (~4s) **לא** נספר ליעד — זה התנהגות Next.js Turbopack/Webpack.

---

## איך לבדוק Production (לא Dev)

```bash
npm run build
npm run start
```

פתח `http://localhost:3000/admin-login`:

- **אין** שורת `○ Compiling /admin-login` בכל רענון.
- `GET /admin-login` אמור להיות **< 1s** (ללא קומפילציה).

אם ב-Production עדיין מופיע `Compiling` — יש בעיה ב-deploy (לא רץ מתוך `.next` build).

---

## Hydration

- `LoginForm` — Client Component קטן (`useActionState` + lucide).
- אין `useSearchParams` בדף — `searchParams` נפתר בשרת (פחות hydration mismatch).
- לוגו — SVG server-side (`WegoWMarkSvg`), לא דרך `AdminChrome`.

---

## המלצות נוספות

1. **התחברות מחדש** אחרי deploy עם `SESSION_SECRET` + JWT עם `perms` — מונע `getCurrentUser` → DB ב-layout admin (לא קשור ל-login).
2. **CSS:** root `layout.tsx` טוען `design-system.css` גלובלי — משפיע על כל האתר כולל login; אופטימיזציה עתידית: route group עם CSS מצומצם ל-auth.
3. **Dev:** המתנה ראשונה ל-route חדש תמיד תכלול compile — זה "רגיל" ב-localhost.

---

## Trace מלא Login → Dashboard (Vercel)

הפעלה ב-Production: **Environment Variable** `LOGIN_TRACE=1` ב-Vercel (כיבוי: `LOGIN_TRACE=0`).

### שלבים (אותו `traceId` בכל השרשרת)

| # | שלב | איפה | `console.time` |
|---|------|------|----------------|
| — | `LOGIN_START` | Client + API | `login.total#<id>` (client) |
| 1 | validate | API `attemptLogin` | `login.validate#<id>` |
| 2 | createSession | `setAdminSession` (perms + JWT) | `login.2.createSession#<id>` |
| 3 | setCookie | `cookies().set` | `login.3.setCookie#<id>` |
| 4 | redirect | Client `window.location.assign` | `login.redirect#<id>` |
| 5 | middleware | `middleware.ts` | `login.middleware#<id>` + `hit` (ספירת ריצות) |
| 6 | requireAuth | `admin-auth` | `login.requireAuth#<id>` |
| 7 | adminLayout | `AdminShellLayout` | `login.adminLayout#<id>` |
| 8 | adminPage | `DashboardGreeting` | `[LOGIN_TRACE] 8.adminPage` |
| 9 | dashboardStream | `DashboardStatsLoader` | `login.dashboardStream#<id>` |
| 10 | firstByte | Client `LoginTraceReporter` | Network: document TTFB |
| 11 | pageInteractive | Client | `login.total#<id>` נסגר |

### איפה לראות לוגים

- **Vercel → Logs / Functions:** `POST /api/auth/login`, `GET /admin`, middleware (Edge).
- **דפדפן → Console:** `LOGIN_START`, `4.redirect`, `10.firstByte`, `11.pageInteractive`.
- **דפדפן → Network:** מי אורך ~5s — בדרך כלל `document` ל-`/admin` או בקשות RSC (`_rsc`, `rsc: 1`).

### מה לבדוק ב-middleware

- `hit > 1` על אותו `traceId` = middleware רץ יותר מפעם (document + prefetch / RSC).
- `isRsc: true` = בקשת React Server Components (לא document ראשי).
- `coldStartLikely: true` + `uptimeSec < 2` = cold start אפשרי ב-Function/Edge.

### DB מיותר אחרי login

בהצלחה, `setAdminSession` קורא `loadPermissionKeysForUser` (EMPLOYEE) + `lastLoginAt` update — שניהם לפני ה-redirect.
אם `6.requireAuth` מופיע פעמיים עם זמן גבוה — `DashboardGreeting` + `DashboardStatsLoader` קוראים `requireAuth` בנפרד (צפוי עם React `cache` באותו request).

---

## שמירת הזמנה (`POST /api/orders/capture`)

### מדידה

הגדר `CAPTURE_PERF=1` (או dev — פעיל כברירת מחדל). בלוגים:

| Scope | משמעות |
|-------|---------|
| `capture.total` | כל ה-API (כולל JSON) |
| `capture.auth` | `getCurrentUser` (JWT + cache, ללא redirect) |
| `capture.validation` | הרשאות + סטטוס + תאריכים |
| `capture.phase1` | קריאות מקבילות: לקוח, שער, מדינות, מספור, מיקום |
| `capture.customer` / `capture.exchangeRate` | בתוך phase1 |
| `capture.insertOrder` / `capture.insertItems` | create/update + תשלומים (`createMany`) |
| `capture.audit` | fire-and-forget (סגירה מיידית) |
| `capture.notifications` / `capture.refresh` | אמור להיות ~0 — אין revalidate בנתיב שמירה |
| `capture.response` | בניית תשובה |

שורת `[capture]` כוללת `apiMs` — פער גדול מול `capture.total` = קומפילציה/cold start ב-dev.

### מה לא רץ בשמירה (UI)

- אין `GET /api/orders/boot` אחרי create (מספר הבא מ-`nextOrderNumberPreview`).
- אין `runWithLoading` גלובלי בשמירה.
- `GET /api/intake-locations` — לא ב-POST capture; רשימה מלאה נטענת פעם אחת (cache שרת 5 דק׳ + sessionStorage בדפדפן).

### צווארי בקבוק אחרונים

- **שער:** `buildCaptureFinancialSnapshot()` תמיד נשלח מהמסך (`financial` + `finalRate` המוצג). `capture.exchangeRate` לא אמור לרוץ — בלוג `[capture] exchangeRateSource: "client"`.
- **לקוח:** עם `customerSnapshot` — אין query ב-save (אימות `isActive` ברקע בלבד).
- **intake-locations:** cache בזיכרון שרת + client; ביטול fetch כפול כש-`paymentPointQuery` ריק ויש כבר רשימה.

### יעד

- חם: **&lt; 500ms** `capture.total`
- מקסימום: **&lt; 1s**

