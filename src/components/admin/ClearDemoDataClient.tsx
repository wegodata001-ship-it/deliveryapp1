"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  CLEAR_DEMO_DATA_CONFIRMATION,
  isClearDemoConfirmationValid,
  type ClearDemoDataPlan,
} from "@/lib/clear-demo-data";
import {
  clearDemoDataAction,
  type ClearDemoDataActionState,
} from "@/app/admin/system/clear-demo-data/actions";

type Props = {
  plan: ClearDemoDataPlan;
};

const COUNT_LABELS: Record<keyof ClearDemoDataPlan["counts"], string> = {
  paymentChecks: "צ׳קים לתשלומים",
  payments: "קליטות תשלום / תשלומים",
  orderEditRequests: "בקשות עריכת הזמנה",
  orders: "הזמנות",
  receiptControls: "בקרת קבלות",
  customerBalanceOverrides: "סטטוס יתרות לקוח",
  customers: "לקוחות",
  excelImportRows: "שורות ייבוא Excel",
  excelImportFiles: "קבצי ייבוא Excel",
  manualImportRows: "שורות ייבוא ידני",
  manualImports: "ייבוא ידני",
  userNotifications: "התראות משתמשים",
  auditLogs: "יומן פעילות",
  legacyRawRows: "נתוני legacy/raw",
  employeeUsers: "משתמשי עובד (ADMIN נשמרים)",
};

export function ClearDemoDataClient({ plan: initialPlan }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<ClearDemoDataActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const canSubmit = isClearDemoConfirmationValid(typed) && !isPending;

  const totalRows = useMemo(() => {
    return Object.values(plan.counts).reduce((sum, n) => sum + n, 0);
  }, [plan.counts]);

  const deletedTotal = useMemo(() => {
    if (!result?.ok) return 0;
    return Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
  }, [result]);

  function submitClear() {
    startTransition(async () => {
      const res = await clearDemoDataAction(typed);
      setResult(res);
      if (res.ok) {
        setPlan(res.plan);
        setConfirmOpen(false);
        setTyped("");
        router.refresh();
      }
    });
  }

  return (
    <div className="adm-source-page clear-demo-page" dir="rtl">
      <div className="adm-source-head">
        <div>
          <h1>ניקוי נתוני מערכת</h1>
          <p>
            מוחק נתוני עבודה בלבד ומשאיר את מבנה המערכת, הרשאות, הגדרות, טבלאות מקור ומשתמשי ADMIN.
            יש להקליד בדיוק <code dir="ltr">{CLEAR_DEMO_DATA_CONFIRMATION}</code> באישור.
            מהטרמינל: <code dir="ltr">npx tsx scripts/clear-demo-data.ts --confirm &quot;{CLEAR_DEMO_DATA_CONFIRMATION}&quot;</code> (ללא{" "}
            <code dir="ltr">--confirm</code> זו רק תצוגה מקדימה).
          </p>
        </div>
      </div>

      <section className="clear-demo-card clear-demo-card--danger">
        <h2>סיכום מחיקה</h2>
        <p>
          סך רשומות למחיקה: <strong>{totalRows.toLocaleString("he-IL")}</strong>
        </p>
        <div className="clear-demo-grid">
          {(Object.entries(plan.counts) as Array<[keyof ClearDemoDataPlan["counts"], number]>).map(([key, value]) => (
            <div className="clear-demo-count" key={key}>
              <span>{COUNT_LABELS[key]}</span>
              <strong>{value.toLocaleString("he-IL")}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="clear-demo-card">
        <h2>יישאר במערכת</h2>
        <ul>
          {plan.preserved.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="clear-demo-card">
        <h2>מספור לאחר ניקוי</h2>
        <ul>
          {plan.resetNotes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {result ? (
        <div className={result.ok ? "clear-demo-result clear-demo-result--ok" : "clear-demo-result clear-demo-result--err"}>
          {result.ok ? (
            <>
              <p>
                הניקוי הושלם ({new Date(result.deletedAt).toLocaleString("he-IL")}) — נמחקו{" "}
                <strong>{deletedTotal.toLocaleString("he-IL")}</strong> רשומות.
              </p>
              {totalRows === 0 ? (
                <p>אין עוד נתוני עבודה למחיקה במסד זה.</p>
              ) : (
                <p>נותרו {totalRows.toLocaleString("he-IL")} רשומות (רענן את הדף אם המספר לא מתעדכן).</p>
              )}
            </>
          ) : (
            result.error
          )}
        </div>
      ) : null}

      <div className="clear-demo-actions">
        <button type="button" className="adm-btn adm-btn--danger" onClick={() => setConfirmOpen(true)}>
          פתיחת אישור מחיקה
        </button>
      </div>

      {confirmOpen ? (
        <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={() => !isPending && setConfirmOpen(false)}>
          <div className="payment-nav-confirm-modal clear-demo-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h4>מחיקת נתוני עבודה</h4>
            <p>
              הפעולה תמחק נתוני עבודה קיימים ולא תמחק טבלאות, schema, settings, permissions או משתמשי ADMIN.
            </p>
            <label className="clear-demo-confirm-label">
              הקלד:
              <code>{CLEAR_DEMO_DATA_CONFIRMATION}</code>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                dir="ltr"
                autoFocus
                disabled={isPending}
              />
            </label>
            <div className="payment-nav-confirm-actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={isPending} onClick={() => setConfirmOpen(false)}>
                ביטול
              </button>
              <button type="button" className="adm-btn adm-btn--danger adm-btn--dense" disabled={!canSubmit} onClick={submitClear}>
                {isPending ? "מנקה…" : "מחיקת נתוני עבודה"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
