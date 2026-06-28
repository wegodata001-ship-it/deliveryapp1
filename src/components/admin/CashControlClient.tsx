"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Coins, DollarSign, ExternalLink, FileSpreadsheet, FileText, Minus, ShieldCheck, Wallet, X } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import {
  approveVarianceAction,
  cancelCashExpenseAction,
  explainVarianceAction,
  getCashDashboardAction,
  getPaymentsControlAction,
  listCashCountsAction,
  listCashDetailAction,
  listCashExpensesAction,
  saveCashCountAction,
  saveCashExpenseAction,
  type CashCountRow,
  type CashDashboard,
  type CashDetailPayload,
  type CashDetailRow,
  type PaymentsControlOrderRow,
  type PaymentsControlPayload,
  type PaymentsControlReceiptRow,
} from "@/app/admin/cash-control/actions";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "@/app/admin/cash-control/constants";

type ExpenseRow = Awaited<ReturnType<typeof listCashExpensesAction>>[number];

type DetailMode = "all" | "receipts" | "expenses" | "variance";

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 12 && n >= 1; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function ils(s: string | null | undefined): string {
  return `₪ ${num(s).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function usd(s: string | null | undefined): string {
  return `$ ${num(s).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function money(currency: CashCurrency, s: string | null | undefined): string {
  return currency === "ILS" ? ils(s) : usd(s);
}

function signed(currency: CashCurrency, s: string | null | undefined): string {
  const n = num(s);
  const body = money(currency, s);
  return n > 0 ? `+${body}` : body;
}

function diffTone(s: string | null | undefined): "pos" | "neg" | "zero" {
  const n = num(s);
  if (n > 0.001) return "pos";
  if (n < -0.001) return "neg";
  return "zero";
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

export function CashControlClient({ isAdmin, initialWeek }: { isAdmin: boolean; initialWeek: string }) {
  const router = useRouter();
  const weekOptions = useMemo(buildWeekOptions, []);
  const [week, setWeek] = useState(initialWeek || weekOptions[0]);
  const [highlightExpenseId, setHighlightExpenseId] = useState<string | null>(null);
  const [dash, setDash] = useState<CashDashboard | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [countOpen, setCountOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [detail, setDetail] = useState<CashDetailPayload | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailMode, setDetailMode] = useState<DetailMode>("all");
  const [detailCtx, setDetailCtx] = useState<{ counted: string | null; diff: string | null }>({
    counted: null,
    diff: null,
  });
  const [detailCounts, setDetailCounts] = useState<CashCountRow[]>([]);
  const [drawerRow, setDrawerRow] = useState<CashDetailRow | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<CashCountRow[]>([]);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [devPayload, setDevPayload] = useState<PaymentsControlPayload | null>(null);
  const [devTab, setDevTab] = useState<PaymentsControlTab>("required");

  async function openDeviations() {
    const res = await getPaymentsControlAction(week);
    setDevPayload(res);
    setDevTab("deviation");
    setDevOpen(true);
  }

  function openIntakeFor(customerId: string | null, orderId: string | null) {
    if (customerId) {
      const params = new URLSearchParams();
      params.set("customerId", customerId);
      router.push(`/admin/payments?${params.toString()}`);
      return;
    }
    if (orderId) router.push(`/admin/orders/${orderId}`);
  }

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  async function exportFile(format: "pdf" | "excel") {
    setExporting(format);
    try {
      // ייצוא Excel ו-PDF מופרדים לשני routes נפרדים בשרת: ל-Excel אין תלות ב-playwright/chromium.
      const endpoint =
        format === "excel"
          ? "/api/controls/cash-control/export/excel"
          : "/api/controls/cash-control/export/pdf";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week }),
      });
      if (!res.ok) {
        const msg = await res.json().then((b) => b?.error).catch(() => null);
        alert(msg ?? "ייצוא נכשל");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") {
        window.open(url, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Cash_Control_${week}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([getCashDashboardAction(week), listCashExpensesAction(week)]).then(([d, e]) => {
      if (cancelled) return;
      setDash(d);
      setExpenses(e);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, refreshTick]);

  useEffect(() => {
    if (!auditOpen) return;
    void listCashCountsAction(week).then(setAudit);
  }, [auditOpen, week, refreshTick]);

  async function openDetail(
    currency: CashCurrency,
    opts: { day?: string; mode?: DetailMode } = {},
  ) {
    const { day, mode = "all" } = opts;
    const curLabel = currency === "ILS" ? "ש״ח" : "דולר";
    const baseTitle =
      mode === "expenses"
        ? `הוצאות קופה ${curLabel}`
        : mode === "variance"
          ? `הרכב הפער ${curLabel}`
          : `קופת ${curLabel}`;
    setDetailMode(mode);
    setDetailCtx({
      counted: currency === "ILS" ? dash?.countedIls ?? null : dash?.countedUsd ?? null,
      diff: currency === "ILS" ? dash?.diffIls ?? null : dash?.diffUsd ?? null,
    });
    setDetailTitle(`${baseTitle} - ${day ? fmtDate(day) : week}`);
    setDetail({ currency, rows: [], receipts: "0.00", expenses: "0.00", total: "0.00" });
    if (mode === "variance") {
      setDetailCounts([]);
      void listCashCountsAction(week).then(setDetailCounts);
    }
    const payload = await listCashDetailAction(week, currency, day);
    setDetail(payload);
  }

  function openMovement(row: CashDetailPayload["rows"][number]) {
    if (row.kind === "RECEIPT") {
      const params = new URLSearchParams();
      params.set("invoiceId", row.id);
      if (row.customerId) params.set("customerId", row.customerId);
      router.push(`/admin/payments?${params.toString()}`);
      return;
    }
    // הוצאת קופה — אין עמוד נפרד: סגירת המודל, הדגשה וגלילה לרשומה בטבלת ההוצאות במסך.
    setDetail(null);
    setAuditOpen(false);
    setHighlightExpenseId(row.id);
    window.setTimeout(() => {
      document.getElementById(`cash-exp-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    window.setTimeout(() => setHighlightExpenseId(null), 4000);
  }

  const hasVariance =
    dash?.lastCount != null && (diffTone(dash.diffIls) !== "zero" || diffTone(dash.diffUsd) !== "zero");

  return (
    <div className="adm-cash" dir="rtl">
      <div className="adm-cash-head">
        <div>
          <h1 className="adm-page-title adm-page-title--sm">
            <Coins size={18} aria-hidden /> בקרת קופה
          </h1>
          <p className="adm-cash-hint">
            בקרה על כסף פיזי בלבד (₪ ו-$). העובד רושם תקבולים והוצאות וסופר את הקופה — המערכת מחשבת
            את ה&quot;אמור להיות&quot; ואת הפער אוטומטית.
          </p>
        </div>
        <div className="adm-cash-actions">
          <label className="adm-cash-week">
            שבוע עבודה
            <select value={week} onChange={(e) => setWeek(e.target.value)} className="adm-orders-week-sel adm-orders-sel-arrow">
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void exportFile("pdf")} disabled={exporting !== null}>
            <FileText size={15} aria-hidden /> {exporting === "pdf" ? "מפיק…" : "PDF"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void exportFile("excel")} disabled={exporting !== null}>
            <FileSpreadsheet size={15} aria-hidden /> {exporting === "excel" ? "מפיק…" : "Excel"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setExpenseOpen(true)}>
            <Minus size={15} aria-hidden /> הוצאת כסף מהקופה
          </button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => setCountOpen(true)}>
            <Wallet size={15} aria-hidden /> ספירת קופה
          </button>
        </div>
      </div>

      <div className="adm-cash-kpibar" aria-busy={loading}>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--rec" onClick={() => void openDetail("USD", { mode: "receipts" })}>
          <span className="adm-cash-kchip__lbl">קבלות $</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{usd(dash?.receiptsUsd)}</strong>
        </button>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--rec" onClick={() => void openDetail("ILS", { mode: "receipts" })}>
          <span className="adm-cash-kchip__lbl">קבלות ₪</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{ils(dash?.receiptsIls)}</strong>
        </button>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--exp" onClick={() => void openDetail("USD", { mode: "expenses" })}>
          <span className="adm-cash-kchip__lbl">הוצאות $</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{usd(dash?.expensesUsd)}</strong>
        </button>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--exp" onClick={() => void openDetail("ILS", { mode: "expenses" })}>
          <span className="adm-cash-kchip__lbl">הוצאות ₪</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{ils(dash?.expensesIls)}</strong>
        </button>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--prof" onClick={() => void openDetail("USD", { mode: "all" })}>
          <span className="adm-cash-kchip__lbl">רווח $</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{usd(dash?.expectedUsd)}</strong>
        </button>
        <button type="button" className="adm-cash-kchip adm-cash-kchip--prof" onClick={() => void openDetail("ILS", { mode: "all" })}>
          <span className="adm-cash-kchip__lbl">רווח ₪</span>
          <strong className="adm-cash-kchip__val" dir="ltr">{ils(dash?.expectedIls)}</strong>
        </button>
        <button
          type="button"
          className={`adm-cash-kchip adm-cash-kchip--dev ${dash && dash.methodDeviations > 0 ? "is-warn" : ""}`}
          onClick={() => void openDeviations()}
          disabled={!dash || dash.methodDeviations === 0}
        >
          <span className="adm-cash-kchip__lbl">חריגות</span>
          <strong className="adm-cash-kchip__val">{dash?.methodDeviations ?? 0}</strong>
        </button>
      </div>

      {hasVariance && dash?.lastCount ? (
        <VarianceBanner
          isAdmin={isAdmin}
          count={dash.lastCount}
          diffIls={dash.diffIls}
          diffUsd={dash.diffUsd}
          onChanged={refresh}
        />
      ) : null}

      <CashControlTable
        week={week}
        dash={dash}
        onOpen={openDetail}
        onOpenDeviations={() => void openDeviations()}
      />

      <div className="adm-cash-section">
        <div className="adm-cash-section__head">
          <h2>הוצאות קופה — {week}</h2>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => setAuditOpen((v) => !v)}>
            {auditOpen ? "הסתר יומן ספירות" : "יומן ספירות (Audit)"}
          </button>
        </div>
        <div className="adm-table-excel-wrap">
          <table className="adm-table-excel">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>מטבע</th>
                <th>סכום</th>
                <th>סיבה</th>
                <th>הערות</th>
                <th>נרשם ע״י</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="adm-table-empty">לא נרשמו הוצאות קופה לשבוע זה.</td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr
                    key={e.id}
                    id={`cash-exp-${e.id}`}
                    className={`adm-table-excel-row ${highlightExpenseId === e.id ? "adm-cash-row-highlight" : ""}`}
                  >
                    <td>{fmtDate(e.expenseDate)}</td>
                    <td>{e.currency === "ILS" ? "₪" : "$"}</td>
                    <td dir="ltr" className="adm-table-excel-num">{money(e.currency, e.amount)}</td>
                    <td>{e.reasonLabel}</td>
                    <td>{e.notes ?? "—"}</td>
                    <td>{e.createdByName ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost adm-btn--xs"
                        title="ביטול הוצאה"
                        onClick={async () => {
                          if (!confirm("לבטל את ההוצאה? הסכום יחזור לקופה.")) return;
                          await cancelCashExpenseAction(e.id);
                          refresh();
                        }}
                      >
                        בטל
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {auditOpen ? <AuditTable rows={audit} isAdmin={isAdmin} onChanged={refresh} /> : null}

      {countOpen ? (
        <CountModal week={week} onClose={() => setCountOpen(false)} onSaved={() => { setCountOpen(false); refresh(); }} />
      ) : null}
      {expenseOpen ? (
        <ExpenseModal week={week} onClose={() => setExpenseOpen(false)} onSaved={() => { setExpenseOpen(false); refresh(); }} />
      ) : null}
      {detail ? (
        <DetailModal
          payload={detail}
          title={detailTitle}
          mode={detailMode}
          counted={detailCtx.counted}
          diff={detailCtx.diff}
          counts={detailCounts}
          onRowClick={(r) => setDrawerRow(r)}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {drawerRow ? (
        <MovementDrawer
          row={drawerRow}
          onOpenOriginal={(r) => {
            setDrawerRow(null);
            openMovement(r);
          }}
          onClose={() => setDrawerRow(null)}
        />
      ) : null}
      {devOpen ? (
        <PaymentsControlModal
          week={week}
          payload={devPayload}
          tab={devTab}
          onTab={setDevTab}
          onOpenIntake={(customerId, orderId) => openIntakeFor(customerId, orderId)}
          onOpenOrder={(orderId) => router.push(`/admin/orders/${orderId}`)}
          onClose={() => setDevOpen(false)}
        />
      ) : null}
    </div>
  );
}

type PaymentsControlTab = "required" | "received" | "missing" | "deviation";

const PC_TABS: { id: PaymentsControlTab; lbl: string; tone: string }[] = [
  { id: "required", lbl: "סה״כ נדרש", tone: "req" },
  { id: "received", lbl: "סה״כ התקבל", tone: "got" },
  { id: "missing", lbl: "סה״כ חסר", tone: "rem" },
  { id: "deviation", lbl: "סה״כ חריגה", tone: "dev" },
];

const PC_ORDER_STATUS: Record<PaymentsControlOrderRow["status"], { icon: string; label: string; cls: string }> = {
  paid: { icon: "✅", label: "שולם", cls: "is-full" },
  partial: { icon: "🟠", label: "חלקי", cls: "is-partial" },
  unpaid: { icon: "❌", label: "חסר", cls: "is-none" },
};

function PaymentsControlModal({
  week,
  payload,
  tab,
  onTab,
  onOpenIntake,
  onOpenOrder,
  onClose,
}: {
  week: string;
  payload: PaymentsControlPayload | null;
  tab: PaymentsControlTab;
  onTab: (t: PaymentsControlTab) => void;
  onOpenIntake: (customerId: string | null, orderId: string | null) => void;
  onOpenOrder: (orderId: string) => void;
  onClose: () => void;
}) {
  const totals = payload?.totals;
  const orders = payload?.orders ?? [];
  const receipts = payload?.receipts ?? [];

  const totalByTab: Record<PaymentsControlTab, string | undefined> = {
    required: totals?.requiredUsd,
    received: totals?.receivedUsd,
    missing: totals?.missingUsd,
    deviation: totals?.deviationUsd,
  };

  const ordersForTab =
    tab === "missing"
      ? orders.filter((o) => num(o.missingUsd) > 0.02)
      : tab === "deviation"
        ? orders.filter((o) => o.hasDeviation)
        : orders;

  return (
    <div className="adm-cash-modal-backdrop" onClick={onClose} role="presentation">
      <div className="adm-cash-modal adm-cash-modal--xwide" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-modal__head">
          <h3>
            <ShieldCheck size={16} aria-hidden /> בקרת תשלומים - {week}
          </h3>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </div>
        <div className="adm-cash-modal__body">
          <div className="adm-cash-dev-summary">
            {PC_TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`adm-cash-dev-sumcard adm-cash-dev-sumcard--${t.tone} adm-cash-dev-sumcard--btn${tab === t.id ? " is-active" : ""}`}
                onClick={() => onTab(t.id)}
              >
                <span className="adm-cash-dev-sumcard__lbl">{t.lbl}</span>
                <span className="adm-cash-dev-sumcard__val" dir="ltr">{usd(totalByTab[t.id])}</span>
              </button>
            ))}
          </div>

          {tab === "received" ? (
            <PaymentsControlReceiptsTable rows={receipts} onOpenIntake={onOpenIntake} onOpenOrder={onOpenOrder} />
          ) : (
            <PaymentsControlOrdersTable
              tab={tab}
              rows={ordersForTab}
              onOpenIntake={onOpenIntake}
              onOpenOrder={onOpenOrder}
            />
          )}
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-cash-dev-btn" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

function PaymentsControlOrdersTable({
  tab,
  rows,
  onOpenIntake,
  onOpenOrder,
}: {
  tab: PaymentsControlTab;
  rows: PaymentsControlOrderRow[];
  onOpenIntake: (customerId: string | null, orderId: string | null) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const emptyMsg =
    tab === "missing"
      ? "אין הזמנות עם תשלום חסר לשבוע זה."
      : tab === "deviation"
        ? "אין הזמנות עם חריגת אמצעי תשלום לשבוע זה."
        : "אין הזמנות לשבוע זה.";
  return (
    <div className="adm-table-excel-wrap">
      <table className="adm-table-excel adm-cash-dev-tbl">
        <thead>
          <tr>
            <th>הזמנה</th>
            <th>לקוח</th>
            <th>תאריך</th>
            <th>אמצעי תשלום</th>
            <th>נדרש</th>
            <th>התקבל</th>
            <th>חסר</th>
            <th>סטטוס</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="adm-table-empty">{emptyMsg}</td>
            </tr>
          ) : (
            rows.map((r) => {
              const st = PC_ORDER_STATUS[r.status];
              return (
                <tr key={r.orderId} className={`adm-cash-dev-trow ${st.cls}`}>
                  <td dir="ltr">{r.orderNumber ?? "—"}</td>
                  <td>{r.customerName ?? "—"}</td>
                  <td dir="ltr">{r.dateYmd}</td>
                  <td>
                    {r.methodLabel}
                    {r.hasDeviation && r.actualMethodLabel ? (
                      <span className="adm-cash-dev-actualtag" dir="rtl"> ← בפועל: {r.actualMethodLabel}</span>
                    ) : null}
                  </td>
                  <td dir="ltr" className="adm-table-excel-num">{usd(r.requiredUsd)}</td>
                  <td dir="ltr" className="adm-table-excel-num adm-cash-dev-cell-got">{usd(r.receivedUsd)}</td>
                  <td dir="ltr" className="adm-table-excel-num adm-cash-dev-cell-rem">{usd(r.missingUsd)}</td>
                  <td className={`adm-cash-dev-status ${st.cls}`}>
                    <span aria-hidden>{st.icon}</span> {st.label}
                  </td>
                  <td>
                    <div className="adm-cash-dev-rowactions">
                      <button type="button" className="adm-cash-dev-minibtn adm-cash-dev-minibtn--primary" onClick={() => onOpenIntake(r.customerId, r.orderId)}>
                        קליטת תשלום
                      </button>
                      <button type="button" className="adm-cash-dev-minibtn" onClick={() => onOpenOrder(r.orderId)}>
                        הזמנה
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsControlReceiptsTable({
  rows,
  onOpenIntake,
  onOpenOrder,
}: {
  rows: PaymentsControlReceiptRow[];
  onOpenIntake: (customerId: string | null, orderId: string | null) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  return (
    <div className="adm-table-excel-wrap">
      <table className="adm-table-excel adm-cash-dev-tbl">
        <thead>
          <tr>
            <th>קוד קליטה</th>
            <th>הזמנה</th>
            <th>לקוח</th>
            <th>תאריך</th>
            <th>אמצעי תשלום</th>
            <th>סכום</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="adm-table-empty">אין קליטות תשלום לשבוע זה.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.paymentId} className="adm-cash-dev-trow">
                <td dir="ltr">{r.paymentCode ?? "—"}</td>
                <td dir="ltr">{r.orderNumber ?? "—"}</td>
                <td>{r.customerName ?? "—"}</td>
                <td dir="ltr">{r.dateYmd}</td>
                <td>{r.methodLabel}</td>
                <td dir="ltr" className="adm-table-excel-num adm-cash-dev-cell-got">{usd(r.amountUsd)}</td>
                <td>
                  <div className="adm-cash-dev-rowactions">
                    <button type="button" className="adm-cash-dev-minibtn adm-cash-dev-minibtn--primary" onClick={() => onOpenIntake(r.customerId, r.orderId)}>
                      קליטת תשלום
                    </button>
                    {r.orderId ? (
                      <button type="button" className="adm-cash-dev-minibtn" onClick={() => onOpenOrder(r.orderId!)}>
                        הזמנה
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function CashControlTable({
  week,
  dash,
  onOpen,
  onOpenDeviations,
}: {
  week: string;
  dash: CashDashboard | null;
  onOpen: (currency: CashCurrency, opts?: { day?: string; mode?: DetailMode }) => void;
  onOpenDeviations: () => void;
}) {
  const days = dash?.days ?? [];

  // יתרה מצטברת (רצה) ל-$ ול-₪
  let balUsd = 0;
  let balIls = 0;
  const rows = days.map((d) => {
    balUsd += num(d.receiptsUsd) - num(d.expensesUsd);
    balIls += num(d.receiptsIls) - num(d.expensesIls);
    return { ...d, balUsd, balIls };
  });

  const totalReceiptsCount = days.reduce((s, d) => s + d.receiptsCount, 0);
  const totalDeviations = days.reduce((s, d) => s + d.deviations, 0);

  const cell = (
    value: string | null | undefined,
    fmt: (s: string | null | undefined) => string,
    currency: CashCurrency,
    day: string,
    mode: DetailMode,
    extraCls = "",
  ) => (
    <td>
      <button
        type="button"
        className={`adm-cash-cellbtn ${num(value) > 0 ? extraCls : "adm-cash-cell--zero"}`}
        onClick={() => onOpen(currency, { day, mode })}
      >
        {fmt(value)}
      </button>
    </td>
  );

  return (
    <section className="adm-cash-maintbl">
      <h2 className="adm-cash-maintbl__title">
        <Coins size={18} aria-hidden /> טבלת בקרת קופה — {week}
      </h2>
      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel adm-cash-maintbl__table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>קבלות $</th>
              <th>קבלות ₪</th>
              <th>הוצאות $</th>
              <th>הוצאות ₪</th>
              <th>יתרה $</th>
              <th>יתרה ₪</th>
              <th>מס׳ קבלות</th>
              <th>חריגות</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="adm-table-empty">אין תנועות מזומן לשבוע זה.</td></tr>
            ) : (
              rows.map((d) => (
                <tr key={d.date} className="adm-table-excel-row">
                  <td className="adm-cash-day__date" dir="ltr">{fmtDate(d.date)}</td>
                  {cell(d.receiptsUsd, usd, "USD", d.date, "receipts", "adm-cash-c-rec")}
                  {cell(d.receiptsIls, ils, "ILS", d.date, "receipts", "adm-cash-c-rec")}
                  {cell(d.expensesUsd, usd, "USD", d.date, "expenses", "adm-cash-c-exp")}
                  {cell(d.expensesIls, ils, "ILS", d.date, "expenses", "adm-cash-c-exp")}
                  <td>
                    <button type="button" className="adm-cash-cellbtn adm-cash-c-expd" onClick={() => onOpen("USD", { day: d.date, mode: "all" })}>
                      {usd(String(d.balUsd))}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="adm-cash-cellbtn adm-cash-c-expd" onClick={() => onOpen("ILS", { day: d.date, mode: "all" })}>
                      {ils(String(d.balIls))}
                    </button>
                  </td>
                  <td dir="ltr" className="adm-cash-cnt-cell">{d.receiptsCount}</td>
                  <td>
                    {d.deviations > 0 ? (
                      <button type="button" className="adm-cash-devcell" onClick={onOpenDeviations} title="לפירוט החריגה">
                        <AlertTriangle size={13} aria-hidden /> {d.deviations}
                      </button>
                    ) : (
                      <span className="adm-cash-cell--zero">0</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="adm-cash-maintbl__foot">
              <td>סה״כ {week}</td>
              <td dir="ltr">{usd(dash?.receiptsUsd)}</td>
              <td dir="ltr">{ils(dash?.receiptsIls)}</td>
              <td dir="ltr">{usd(dash?.expensesUsd)}</td>
              <td dir="ltr">{ils(dash?.expensesIls)}</td>
              <td dir="ltr" className="adm-cash-maintbl__prof">{usd(dash?.expectedUsd)}</td>
              <td dir="ltr" className="adm-cash-maintbl__prof">{ils(dash?.expectedIls)}</td>
              <td dir="ltr">{totalReceiptsCount}</td>
              <td dir="ltr">{totalDeviations}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function VarianceBanner({
  isAdmin,
  count,
  diffIls,
  diffUsd,
  onChanged,
}: {
  isAdmin: boolean;
  count: NonNullable<CashDashboard["lastCount"]>;
  diffIls: string | null;
  diffUsd: string | null;
  onChanged: () => void;
}) {
  const [note, setNote] = useState(count.varianceNote ?? "");
  const [busy, setBusy] = useState(false);
  const approved = count.varianceStatus === "APPROVED";

  return (
    <div className={`adm-cash-variance ${approved ? "adm-cash-variance--approved" : ""}`}>
      <div className="adm-cash-variance__title">
        <AlertTriangle size={16} aria-hidden />
        {approved ? "פער אושר" : "זוהתה חריגה בקופה"}
        <span dir="ltr" className="adm-cash-variance__amt">
          {diffTone(diffIls) !== "zero" ? `₪ ${diffIls}` : ""} {diffTone(diffUsd) !== "zero" ? `$ ${diffUsd}` : ""}
        </span>
      </div>
      <div className="adm-cash-variance__row">
        <textarea
          className="adm-cash-variance__note"
          placeholder="הסבר פער…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <div className="adm-cash-variance__btns">
          <button
            type="button"
            className="adm-btn adm-btn--ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await explainVarianceAction(count.id, note);
              setBusy(false);
              onChanged();
            }}
          >
            שמור הסבר
          </button>
          {!approved ? (
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              disabled={busy || !isAdmin}
              title={!isAdmin ? "רק מנהל מערכת יכול לאשר פער" : undefined}
              onClick={async () => {
                setBusy(true);
                const res = await approveVarianceAction(count.id);
                setBusy(false);
                if (!res.ok) {
                  alert(res.error ?? "שגיאה");
                  return;
                }
                onChanged();
              }}
            >
              <ShieldCheck size={15} aria-hidden /> אשר פער
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AuditTable({ rows, isAdmin, onChanged }: { rows: CashCountRow[]; isAdmin: boolean; onChanged: () => void }) {
  return (
    <div className="adm-cash-section">
      <div className="adm-cash-section__head">
        <h2>יומן ספירות קופה</h2>
      </div>
      <div className="adm-table-excel-wrap">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>ש״ח מערכת</th>
              <th>ש״ח בפועל</th>
              <th>פער ₪</th>
              <th>דולר מערכת</th>
              <th>דולר בפועל</th>
              <th>פער $</th>
              <th>סטטוס</th>
              <th>משתמש</th>
              <th>הערה</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="adm-table-empty">לא בוצעו ספירות.</td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="adm-table-excel-row">
                  <td>{fmtDateTime(c.countedAt)}</td>
                  <td dir="ltr" className="adm-table-excel-num">{ils(c.expectedIls)}</td>
                  <td dir="ltr" className="adm-table-excel-num">{ils(c.countedIls)}</td>
                  <td dir="ltr" className={`adm-table-excel-num adm-cash-cell--${diffTone(c.diffIls)}`}>{signed("ILS", c.diffIls)}</td>
                  <td dir="ltr" className="adm-table-excel-num">{usd(c.expectedUsd)}</td>
                  <td dir="ltr" className="adm-table-excel-num">{usd(c.countedUsd)}</td>
                  <td dir="ltr" className={`adm-table-excel-num adm-cash-cell--${diffTone(c.diffUsd)}`}>{signed("USD", c.diffUsd)}</td>
                  <td>
                    <span className={`adm-recon-tag ${c.varianceStatus === "APPROVED" ? "adm-recon-tag--matched" : "adm-recon-tag--diff"}`}>
                      {c.varianceStatus === "APPROVED" ? "אושר" : "פתוח"}
                    </span>
                  </td>
                  <td>{c.createdByName ?? "—"}</td>
                  <td>{c.varianceNote ?? "—"}</td>
                  <td>
                    {c.varianceStatus !== "APPROVED" && isAdmin ? (
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost adm-btn--xs"
                        onClick={async () => {
                          await approveVarianceAction(c.id);
                          onChanged();
                        }}
                      >
                        אשר
                      </button>
                    ) : (
                      c.approvedByName ?? ""
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CountModal({ week, onClose, onSaved }: { week: string; onClose: () => void; onSaved: () => void }) {
  const [countedIls, setCountedIls] = useState("");
  const [countedUsd, setCountedUsd] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="adm-cash-modal-backdrop" onClick={onClose}>
      <div className="adm-cash-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-modal__head">
          <h3><Wallet size={16} aria-hidden /> ספירת קופה — {week}</h3>
          <button type="button" className="adm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-cash-modal__body">
          <label className="adm-cash-field">
            <span>ש״ח בפועל</span>
            <input type="number" inputMode="decimal" value={countedIls} onChange={(e) => setCountedIls(e.target.value)} placeholder="0" dir="ltr" />
          </label>
          <label className="adm-cash-field">
            <span>דולר בפועל</span>
            <input type="number" inputMode="decimal" value={countedUsd} onChange={(e) => setCountedUsd(e.target.value)} placeholder="0" dir="ltr" />
          </label>
          <label className="adm-cash-field">
            <span>הערות</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>ביטול</button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveCashCountAction({ week, countedIls: countedIls || 0, countedUsd: countedUsd || 0, notes });
              setBusy(false);
              if (!res.ok) {
                alert(res.error ?? "שגיאה");
                return;
              }
              onSaved();
            }}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpenseModal({ week, onClose, onSaved }: { week: string; onClose: () => void; onSaved: () => void }) {
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CashCurrency>("ILS");
  const [reason, setReason] = useState<CashExpenseReason>("FUEL");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="adm-cash-modal-backdrop" onClick={onClose}>
      <div className="adm-cash-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-modal__head">
          <h3><Minus size={16} aria-hidden /> הוצאת כסף מהקופה</h3>
          <button type="button" className="adm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-cash-modal__body">
          <label className="adm-cash-field">
            <span>תאריך</span>
            <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} dir="ltr" />
          </label>
          <div className="adm-cash-field-row">
            <label className="adm-cash-field">
              <span>סכום</span>
              <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" dir="ltr" />
            </label>
            <label className="adm-cash-field">
              <span>מטבע</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as CashCurrency)}>
                <option value="ILS">₪ ש״ח</option>
                <option value="USD">$ דולר</option>
              </select>
            </label>
          </div>
          <label className="adm-cash-field">
            <span>סיבה</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as CashExpenseReason)}>
              {CASH_EXPENSE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="adm-cash-field">
            <span>הערות</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>ביטול</button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveCashExpenseAction({ week, currency, amount: amount || 0, reason, notes, expenseDate });
              setBusy(false);
              if (!res.ok) {
                alert(res.error ?? "שגיאה");
                return;
              }
              onSaved();
            }}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}

const CASH_METHOD_TAG_CLASS: Record<NonNullable<CashDetailRow["methodBucket"]>, string> = {
  CASH: "adm-cash-mtag--cash",
  BANK_TRANSFER: "adm-cash-mtag--bank",
  CREDIT: "adm-cash-mtag--credit",
  CHECK: "adm-cash-mtag--check",
  OTHER: "adm-cash-mtag--other",
};

function CashMethodTag({ row }: { row: CashDetailRow }) {
  if (row.kind === "EXPENSE") {
    return <span className="adm-cash-mtag adm-cash-mtag--other">{row.reasonLabel ?? "הוצאה"}</span>;
  }
  const cls = row.methodBucket ? CASH_METHOD_TAG_CLASS[row.methodBucket] : "adm-cash-mtag--other";
  return <span className={`adm-cash-mtag ${cls}`}>{row.methodLabel ?? "מזומן"}</span>;
}

function DetailModal({
  payload,
  title,
  mode,
  counted,
  diff,
  counts,
  onRowClick,
  onClose,
}: {
  payload: CashDetailPayload;
  title: string;
  mode: DetailMode;
  counted: string | null;
  diff: string | null;
  counts: CashCountRow[];
  onRowClick: (row: CashDetailRow) => void;
  onClose: () => void;
}) {
  const c = payload.currency;
  const rows =
    mode === "receipts"
      ? payload.rows.filter((r) => r.kind === "RECEIPT")
      : mode === "expenses"
        ? payload.rows.filter((r) => r.kind === "EXPENSE")
        : payload.rows;

  const receiptRows = rows.filter((r) => r.kind === "RECEIPT");
  const sumUsd = receiptRows.reduce((s, r) => s + num(r.amountUsd), 0);
  const sumIls = receiptRows.reduce((s, r) => s + num(r.amountIls), 0);
  const users = Array.from(new Set(receiptRows.map((r) => r.userName).filter(Boolean))) as string[];
  const userLabel = users.length === 0 ? "—" : users.length === 1 ? users[0] : `${users.length} משתמשים`;
  const isVariance = mode === "variance";

  return (
    <div className="adm-cash-modal-backdrop" onClick={onClose}>
      <div className="adm-cash-modal adm-cash-modal--xl" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-modal__head">
          <h3>
            {c === "ILS" ? <Coins size={16} aria-hidden /> : <DollarSign size={16} aria-hidden />}
            {title || `פירוט ${c === "ILS" ? "ש״ח" : "דולר"}`}
          </h3>
          <button type="button" className="adm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-cash-modal__body">
          {isVariance ? (
            <VarianceDetail currency={c} expected={payload.total} counted={counted} diff={diff} counts={counts} />
          ) : (
            <>
              {mode !== "expenses" ? (
                <div className="adm-cash-detail-kpis">
                  <div className="adm-cash-detail-kpi adm-cash-detail-kpi--usd">
                    <span className="adm-cash-detail-kpi__lbl">התקבל דולר</span>
                    <strong className="adm-cash-detail-kpi__val" dir="ltr">{usd(String(sumUsd))}</strong>
                  </div>
                  <div className="adm-cash-detail-kpi adm-cash-detail-kpi--ils">
                    <span className="adm-cash-detail-kpi__lbl">התקבל ₪</span>
                    <strong className="adm-cash-detail-kpi__val" dir="ltr">{ils(String(sumIls))}</strong>
                  </div>
                  <div className="adm-cash-detail-kpi adm-cash-detail-kpi--cnt">
                    <span className="adm-cash-detail-kpi__lbl">מספר תנועות</span>
                    <strong className="adm-cash-detail-kpi__val">{receiptRows.length}</strong>
                  </div>
                  <div className="adm-cash-detail-kpi adm-cash-detail-kpi--user">
                    <span className="adm-cash-detail-kpi__lbl">משתמש קולט</span>
                    <strong className="adm-cash-detail-kpi__val adm-cash-detail-kpi__val--txt">{userLabel}</strong>
                  </div>
                </div>
              ) : null}
              <MovementsTable currency={c} rows={rows} mode={mode} payload={payload} onRowClick={onRowClick} />
            </>
          )}
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

function MovementsTable({
  currency,
  rows,
  mode,
  payload,
  onRowClick,
}: {
  currency: CashCurrency;
  rows: CashDetailPayload["rows"];
  mode: DetailMode;
  payload: CashDetailPayload;
  onRowClick: (row: CashDetailRow) => void;
}) {
  return (
    <div className="adm-table-excel-wrap">
      <table className="adm-table-excel adm-cash-detail-tbl">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>הזמנה</th>
            <th>קליטת תשלום</th>
            <th>לקוח</th>
            <th>דולר</th>
            <th>₪</th>
            <th>אמצעי תשלום</th>
            <th>משתמש</th>
            <th aria-label="מסמך" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="adm-table-empty">אין תנועות מזומן בטווח זה.</td></tr>
          ) : (
            rows.map((r) => (
              <tr
                key={`${r.kind}:${r.id}`}
                className="adm-table-excel-row adm-cash-row-link"
                onClick={() => onRowClick(r)}
                title={r.kind === "RECEIPT" ? "פרטי קליטת תשלום" : "פרטי הוצאת קופה"}
              >
                <td dir="ltr">{fmtDate(r.date)}</td>
                <td dir="ltr">{r.orderNumber ?? "—"}</td>
                <td dir="ltr">{r.docLabel ?? "—"}</td>
                <td>{r.customerName ?? (r.kind === "EXPENSE" ? r.movementLabel : "—")}</td>
                <td dir="ltr" className={`adm-table-excel-num ${r.kind === "EXPENSE" ? "adm-cash-cell--neg" : "adm-cash-cell--pos"}`}>
                  {r.amountUsd ? usd(r.amountUsd) : "—"}
                </td>
                <td dir="ltr" className={`adm-table-excel-num ${r.kind === "EXPENSE" ? "adm-cash-cell--neg" : "adm-cash-cell--pos"}`}>
                  {r.amountIls ? ils(r.amountIls) : "—"}
                </td>
                <td><CashMethodTag row={r} /></td>
                <td>{r.userName ?? "—"}</td>
                <td className="adm-cash-row-link__icon">
                  {r.documents.length > 0 ? (
                    <span className="adm-cash-doc-badge" title={`${r.documents.length} מסמכים מצורפים`}>
                      <FileText size={13} aria-hidden /> {r.documents.length}
                    </span>
                  ) : (
                    <ExternalLink size={14} aria-hidden />
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          {mode === "expenses" ? (
            <tr>
              <td colSpan={7} className="adm-cash-detail-foot adm-cash-detail-foot--total">סה״כ הוצאות קופה</td>
              <td dir="ltr" colSpan={2} className="adm-table-excel-num adm-cash-cell--neg">{money(currency, `-${payload.expenses}`)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={7} className="adm-cash-detail-foot">קליטות מזומן</td>
                <td dir="ltr" colSpan={2} className="adm-table-excel-num adm-cash-cell--pos">{money(currency, payload.receipts)}</td>
              </tr>
              {num(payload.expenses) > 0 ? (
                <tr>
                  <td colSpan={7} className="adm-cash-detail-foot">הוצאות קופה</td>
                  <td dir="ltr" colSpan={2} className="adm-table-excel-num adm-cash-cell--neg">{money(currency, `-${payload.expenses}`)}</td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={7} className="adm-cash-detail-foot adm-cash-detail-foot--total">צפוי בקופה</td>
                <td dir="ltr" colSpan={2} className="adm-table-excel-num adm-cash-detail-total">{money(currency, payload.total)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
    </div>
  );
}

function MovementDrawer({
  row,
  onOpenOriginal,
  onClose,
}: {
  row: CashDetailRow;
  onOpenOriginal: (row: CashDetailRow) => void;
  onClose: () => void;
}) {
  const isReceipt = row.kind === "RECEIPT";
  return (
    <div className="adm-cash-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="adm-cash-drawer" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-drawer__head">
          <h3>{isReceipt ? "פרטי קליטת תשלום" : "פרטי הוצאת קופה"}</h3>
          <button type="button" className="adm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-cash-drawer__body">
          {isReceipt ? (
            <>
              <DrawerField label="לקוח" value={row.customerName ?? "—"} />
              <DrawerField label="הזמנה" value={row.orderNumber ?? "—"} ltr />
              <DrawerField label="קליטת תשלום" value={row.docLabel ?? "—"} ltr />
              <div className="adm-cash-drawer__amounts">
                <div className="adm-cash-drawer__amt adm-cash-drawer__amt--usd">
                  <span>התקבל דולר</span>
                  <strong dir="ltr">{row.amountUsd ? usd(row.amountUsd) : "—"}</strong>
                </div>
                <div className="adm-cash-drawer__amt adm-cash-drawer__amt--ils">
                  <span>התקבל ₪</span>
                  <strong dir="ltr">{row.amountIls ? ils(row.amountIls) : "—"}</strong>
                </div>
              </div>
              <div className="adm-cash-drawer__field">
                <span className="adm-cash-drawer__lbl">אמצעי תשלום</span>
                <CashMethodTag row={row} />
              </div>
            </>
          ) : (
            <>
              <DrawerField label="סוג הוצאה" value={row.reasonLabel ?? "—"} />
              <div className="adm-cash-drawer__amounts">
                <div className="adm-cash-drawer__amt adm-cash-drawer__amt--ils">
                  <span>סכום</span>
                  <strong dir="ltr">{row.amountUsd ?? row.amountIls ?? "—"}</strong>
                </div>
              </div>
            </>
          )}
          <DrawerField label="נקלט על ידי" value={row.userName ?? "—"} />
          <DrawerField label="תאריך" value={fmtDateTime(row.date)} ltr />
          {row.notes ? <DrawerField label="הערה" value={row.notes} /> : null}

          {row.documents.length > 0 ? (
            <div className="adm-cash-drawer__docs">
              <span className="adm-cash-drawer__lbl">מסמכים מצורפים</span>
              {row.documents.map((d) => (
                <a
                  key={d.id}
                  className="adm-cash-drawer__doc"
                  href={`/api/documents/${d.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText size={14} aria-hidden /> {d.fileName}
                </a>
              ))}
            </div>
          ) : (
            <DrawerField label="מסמך מצורף" value="אין" />
          )}
        </div>
        <div className="adm-cash-drawer__foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>סגור</button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => onOpenOriginal(row)}>
            <ExternalLink size={14} aria-hidden /> {isReceipt ? "פתח קליטת תשלום מקורית" : "הצג הוצאה במסך"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function DrawerField({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="adm-cash-drawer__field">
      <span className="adm-cash-drawer__lbl">{label}</span>
      <span className="adm-cash-drawer__val" dir={ltr ? "ltr" : undefined}>{value}</span>
    </div>
  );
}

function VarianceDetail({
  currency,
  expected,
  counted,
  diff,
  counts,
}: {
  currency: CashCurrency;
  expected: string;
  counted: string | null;
  diff: string | null;
  counts: CashCountRow[];
}) {
  return (
    <div className="adm-cash-detail-stack">
      <div className="adm-cash-var-summary">
        <div className="adm-cash-var-cell">
          <span>צפוי בקופה</span>
          <strong dir="ltr">{money(currency, expected)}</strong>
        </div>
        <div className="adm-cash-var-cell">
          <span>נספר בפועל</span>
          <strong dir="ltr">{counted ? money(currency, counted) : "טרם נספר"}</strong>
        </div>
        <div className={`adm-cash-var-cell adm-cash-var-cell--${counted ? (diffTone(diff) === "zero" ? "ok" : "warn") : "none"}`}>
          <span>פער</span>
          <strong dir="ltr">{counted ? signed(currency, diff) : "—"}</strong>
        </div>
      </div>
      <div>
        <h4 className="adm-cash-detail-sub">היסטוריית ספירות</h4>
        <div className="adm-table-excel-wrap">
          <table className="adm-table-excel">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>מי ספר</th>
                <th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {counts.length === 0 ? (
                <tr><td colSpan={3} className="adm-table-empty">לא בוצעו ספירות לשבוע זה.</td></tr>
              ) : (
                counts.map((c) => (
                  <tr key={c.id} className="adm-table-excel-row">
                    <td>{fmtDateTime(c.countedAt)}</td>
                    <td>{c.createdByName ?? "—"}</td>
                    <td>{c.varianceNote ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
