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
      const res = await fetch("/api/controls/cash-control/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, format }),
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
    const modeLabel =
      mode === "receipts"
        ? "קליטות מזומן"
        : mode === "expenses"
          ? "הוצאות קופה"
          : mode === "variance"
            ? "הרכב הפער"
            : "תנועות מזומן";
    setDetailMode(mode);
    setDetailCtx({
      counted: currency === "ILS" ? dash?.countedIls ?? null : dash?.countedUsd ?? null,
      diff: currency === "ILS" ? dash?.diffIls ?? null : dash?.diffUsd ?? null,
    });
    setDetailTitle(`${modeLabel} ${curLabel} — ${day ? fmtDate(day) : week}`);
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

      <div className="adm-cash-kpi-grid" aria-busy={loading}>
        {(["ILS", "USD"] as const).map((cur) => {
          const fmt = cur === "ILS" ? ils : usd;
          const receipts = cur === "ILS" ? dash?.receiptsIls : dash?.receiptsUsd;
          const expensesV = cur === "ILS" ? dash?.expensesIls : dash?.expensesUsd;
          const expected = cur === "ILS" ? dash?.expectedIls : dash?.expectedUsd;
          const counted = cur === "ILS" ? dash?.countedIls : dash?.countedUsd;
          const diff = cur === "ILS" ? dash?.diffIls : dash?.diffUsd;
          return (
            <div className="adm-cash-curblock" key={cur}>
              <div className="adm-cash-curblock__title">
                {cur === "ILS" ? <Coins size={15} aria-hidden /> : <DollarSign size={15} aria-hidden />}
                {cur === "ILS" ? "מזומן ש״ח (₪)" : "מזומן דולר ($)"}
              </div>
              <div className="adm-cash-kpi-row">
                <button type="button" className="adm-cash-kpi adm-cash-kpi--src" onClick={() => void openDetail(cur, { mode: "receipts" })}>
                  <span className="adm-cash-kpi__head">סה״כ קליטות מזומן</span>
                  <strong className="adm-cash-kpi__val" dir="ltr">{fmt(receipts)}</strong>
                  <span className="adm-cash-kpi__sub">לחץ לפירוט</span>
                </button>
                <button type="button" className="adm-cash-kpi adm-cash-kpi--out" onClick={() => void openDetail(cur, { mode: "expenses" })}>
                  <span className="adm-cash-kpi__head">סה״כ הוצאות קופה</span>
                  <strong className="adm-cash-kpi__val" dir="ltr">{fmt(expensesV)}</strong>
                  <span className="adm-cash-kpi__sub">לחץ לפירוט</span>
                </button>
                <button type="button" className="adm-cash-kpi adm-cash-kpi--expected" onClick={() => void openDetail(cur, { mode: "all" })}>
                  <span className="adm-cash-kpi__head">צפוי בקופה</span>
                  <strong className="adm-cash-kpi__val" dir="ltr">{fmt(expected)}</strong>
                  <span className="adm-cash-kpi__sub">קליטות − הוצאות</span>
                </button>
                <div className="adm-cash-kpi adm-cash-kpi--counted">
                  <span className="adm-cash-kpi__head">נספר בפועל</span>
                  <strong className="adm-cash-kpi__val" dir="ltr">{counted ? fmt(counted) : "—"}</strong>
                </div>
                <button
                  type="button"
                  className={`adm-cash-kpi adm-cash-kpi--diff ${counted ? (diffTone(diff) === "zero" ? "adm-cash-kpi--var-ok" : "adm-cash-kpi--var-warn") : ""}`}
                  onClick={() => void openDetail(cur, { mode: "variance" })}
                >
                  <span className="adm-cash-kpi__head">פער</span>
                  <strong className="adm-cash-kpi__val" dir="ltr">{counted ? signed(cur, diff) : "—"}</strong>
                  <span className="adm-cash-kpi__sub">לחץ להרכב הפער</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {dash && dash.methodDeviations > 0 ? (
        <button type="button" className="adm-cash-devbar" onClick={() => void openDeviations()}>
          <AlertTriangle size={16} aria-hidden />
          <span className="adm-cash-devbar__txt">נמצאו</span>
          <strong className="adm-cash-devbar__count">{dash.methodDeviations}</strong>
          <span className="adm-cash-devbar__txt">חריגות תשלום</span>
          <span className="adm-cash-devbar__hint">לחץ לפירוט מלא</span>
        </button>
      ) : null}

      {hasVariance && dash?.lastCount ? (
        <VarianceBanner
          isAdmin={isAdmin}
          count={dash.lastCount}
          diffIls={dash.diffIls}
          diffUsd={dash.diffUsd}
          onChanged={refresh}
        />
      ) : null}

      <div className="adm-cash-tables">
        <CurrencyCashTable
          currency="ILS"
          week={week}
          days={dash?.days ?? []}
          totalReceipts={dash?.receiptsIls}
          totalExpenses={dash?.expensesIls}
          totalExpected={dash?.expectedIls}
          onOpen={openDetail}
        />
        <CurrencyCashTable
          currency="USD"
          week={week}
          days={dash?.days ?? []}
          totalReceipts={dash?.receiptsUsd}
          totalExpenses={dash?.expensesUsd}
          totalExpected={dash?.expectedUsd}
          onOpen={openDetail}
        />
      </div>

      {dash ? <WeekSummaryCard week={week} dash={dash} /> : null}

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
          onOpenRow={openMovement}
          onClose={() => setDetail(null)}
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

function CurrencyCashTable({
  currency,
  week,
  days,
  totalReceipts,
  totalExpenses,
  totalExpected,
  onOpen,
}: {
  currency: CashCurrency;
  week: string;
  days: CashDashboard["days"];
  totalReceipts: string | undefined;
  totalExpenses: string | undefined;
  totalExpected: string | undefined;
  onOpen: (currency: CashCurrency, opts?: { day?: string; mode?: DetailMode }) => void;
}) {
  const isIls = currency === "ILS";
  const fmt = isIls ? ils : usd;
  const tone = isIls ? "ils" : "usd";

  return (
    <section className={`adm-cash-ctable adm-cash-ctable--${tone}`}>
      <h2 className={`adm-cash-ctable__title adm-cash-ctable__title--${tone}`}>
        {isIls ? <Coins size={18} aria-hidden /> : <DollarSign size={18} aria-hidden />}
        {isIls ? "קופת ש״ח" : "קופת דולר"} — {week}
      </h2>
      <div className="adm-table-excel-wrap adm-cash-days-wrap">
        <table className="adm-table-excel adm-cash-ctable__table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>קליטות</th>
              <th>הוצאות</th>
              <th>צפי</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 ? (
              <tr><td colSpan={4} className="adm-table-empty">אין תנועות מזומן לשבוע זה.</td></tr>
            ) : (
              days.map((d) => {
                const rec = isIls ? d.receiptsIls : d.receiptsUsd;
                const exp = isIls ? d.expensesIls : d.expensesUsd;
                const expd = isIls ? d.expectedIls : d.expectedUsd;
                const rowCls = num(exp) > 0 ? "adm-cash-day--exp" : num(rec) > 0 ? "adm-cash-day--act" : "adm-cash-day--idle";
                return (
                  <tr key={d.date} className={`adm-table-excel-row ${rowCls}`}>
                    <td className="adm-cash-day__date">{fmtDate(d.date)}</td>
                    <td>
                      <button type="button" className={`adm-cash-cellbtn ${num(rec) > 0 ? "adm-cash-c-rec" : "adm-cash-cell--zero"}`} onClick={() => onOpen(currency, { day: d.date, mode: "receipts" })}>
                        {fmt(rec)}
                      </button>
                    </td>
                    <td>
                      <button type="button" className={`adm-cash-cellbtn ${num(exp) > 0 ? "adm-cash-c-exp" : "adm-cash-cell--zero"}`} onClick={() => onOpen(currency, { day: d.date, mode: "expenses" })}>
                        {fmt(exp)}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="adm-cash-cellbtn adm-cash-c-expd" onClick={() => onOpen(currency, { day: d.date, mode: "all" })}>
                        {fmt(expd)}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className={`adm-cash-ctable__foot adm-cash-ctable__foot--${tone}`}>
              <td>סה״כ {week}</td>
              <td dir="ltr">{fmt(totalReceipts)}</td>
              <td dir="ltr">{fmt(totalExpenses)}</td>
              <td dir="ltr">{fmt(totalExpected)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function WeekSummaryCard({ week, dash }: { week: string; dash: CashDashboard }) {
  return (
    <div className="adm-cash-weeksum">
      <div className="adm-cash-weeksum__title">סה״כ שבוע {week}</div>
      <div className="adm-cash-weeksum__grid">
        <div className="adm-cash-weeksum__cur adm-cash-weeksum__cur--ils">
          <h4><Coins size={16} aria-hidden /> קופת ש״ח</h4>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--rec"><span>קליטות</span><strong dir="ltr">{ils(dash.receiptsIls)}</strong></div>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--exp"><span>הוצאות</span><strong dir="ltr">{ils(dash.expensesIls)}</strong></div>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--expd"><span>צפי בקופה</span><strong dir="ltr">{ils(dash.expectedIls)}</strong></div>
        </div>
        <div className="adm-cash-weeksum__cur adm-cash-weeksum__cur--usd">
          <h4><DollarSign size={16} aria-hidden /> קופת דולר</h4>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--rec"><span>קליטות</span><strong dir="ltr">{usd(dash.receiptsUsd)}</strong></div>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--exp"><span>הוצאות</span><strong dir="ltr">{usd(dash.expensesUsd)}</strong></div>
          <div className="adm-cash-weeksum__line adm-cash-weeksum__line--expd"><span>צפי בקופה</span><strong dir="ltr">{usd(dash.expectedUsd)}</strong></div>
        </div>
      </div>
    </div>
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

function DetailModal({
  payload,
  title,
  mode,
  counted,
  diff,
  counts,
  onOpenRow,
  onClose,
}: {
  payload: CashDetailPayload;
  title: string;
  mode: DetailMode;
  counted: string | null;
  diff: string | null;
  counts: CashCountRow[];
  onOpenRow: (row: CashDetailPayload["rows"][number]) => void;
  onClose: () => void;
}) {
  const c = payload.currency;
  const rows =
    mode === "receipts"
      ? payload.rows.filter((r) => r.kind === "RECEIPT")
      : mode === "expenses"
        ? payload.rows.filter((r) => r.kind === "EXPENSE")
        : payload.rows;

  return (
    <div className="adm-cash-modal-backdrop" onClick={onClose}>
      <div className="adm-cash-modal adm-cash-modal--wide" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="adm-cash-modal__head">
          <h3>
            {c === "ILS" ? <Coins size={16} aria-hidden /> : <DollarSign size={16} aria-hidden />}
            {title || `פירוט ${c === "ILS" ? "ש״ח" : "דולר"}`}
          </h3>
          <button type="button" className="adm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="adm-cash-modal__body">
          {mode === "variance" ? (
            <VarianceDetail currency={c} expected={payload.total} counted={counted} diff={diff} counts={counts} />
          ) : (
            <MovementsTable currency={c} rows={rows} mode={mode} payload={payload} onOpenRow={onOpenRow} />
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
  onOpenRow,
}: {
  currency: CashCurrency;
  rows: CashDetailPayload["rows"];
  mode: DetailMode;
  payload: CashDetailPayload;
  onOpenRow: (row: CashDetailPayload["rows"][number]) => void;
}) {
  return (
    <div className="adm-table-excel-wrap">
      <table className="adm-table-excel">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>מספר מסמך</th>
            <th>לקוח</th>
            <th>סוג תנועה</th>
            <th>משתמש</th>
            <th>סכום</th>
            <th aria-label="פתיחה" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="adm-table-empty">אין תנועות מזומן בטווח זה.</td></tr>
          ) : (
            rows.map((r) => (
              <tr
                key={`${r.kind}:${r.id}`}
                className="adm-table-excel-row adm-cash-row-link"
                onClick={() => onOpenRow(r)}
                title={r.kind === "RECEIPT" ? "פתח קליטת תשלום מקורית" : "הצג הוצאת קופה במסך"}
              >
                <td>{fmtDate(r.date)}</td>
                <td dir="ltr">{r.docLabel ?? "—"}</td>
                <td>{r.customerName ?? (r.notes ? r.notes : "—")}</td>
                <td>
                  <span className={`adm-recon-tag ${r.kind === "EXPENSE" ? "adm-recon-tag--diff" : "adm-recon-tag--matched"}`}>
                    {r.movementLabel}
                  </span>
                </td>
                <td>{r.userName ?? "—"}</td>
                <td dir="ltr" className={`adm-table-excel-num ${r.kind === "EXPENSE" ? "adm-cash-cell--neg" : "adm-cash-cell--pos"}`}>
                  {money(currency, r.amount)}
                </td>
                <td className="adm-cash-row-link__icon"><ExternalLink size={14} aria-hidden /></td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          {mode === "receipts" ? (
            <tr>
              <td colSpan={5} className="adm-cash-detail-foot adm-cash-detail-foot--total">סה״כ קליטות מזומן</td>
              <td dir="ltr" className="adm-table-excel-num adm-cash-detail-total">{money(currency, payload.receipts)}</td>
              <td />
            </tr>
          ) : mode === "expenses" ? (
            <tr>
              <td colSpan={5} className="adm-cash-detail-foot adm-cash-detail-foot--total">סה״כ הוצאות קופה</td>
              <td dir="ltr" className="adm-table-excel-num adm-cash-cell--neg">{money(currency, `-${payload.expenses}`)}</td>
              <td />
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={5} className="adm-cash-detail-foot">תקבולים (קליטות מזומן)</td>
                <td dir="ltr" className="adm-table-excel-num adm-cash-cell--pos">{money(currency, payload.receipts)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={5} className="adm-cash-detail-foot">הוצאות קופה</td>
                <td dir="ltr" className="adm-table-excel-num adm-cash-cell--neg">{money(currency, `-${payload.expenses}`)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={5} className="adm-cash-detail-foot adm-cash-detail-foot--total">צפוי בקופה</td>
                <td dir="ltr" className="adm-table-excel-num adm-cash-detail-total">{money(currency, payload.total)}</td>
                <td />
              </tr>
            </>
          )}
        </tfoot>
      </table>
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
