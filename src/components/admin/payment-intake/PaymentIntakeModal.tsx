"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { AdminToastFn } from "@/components/admin/AdminNavShell";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import {
  searchCustomersPaymentIntakeAction,
  fetchPaymentIntakeCustomerOrdersAction,
} from "@/app/admin/payments/intake/actions";
import { savePaymentIntakeV2Action } from "@/app/admin/payment-intake/save-payment-intake-action";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import { roundMoney2 } from "@/lib/payment-intake";
import { computeReceivedUsd, compareReceivedToDebt } from "@/lib/payment-intake-rebuild/compare";
import { INTAKE_METHOD_OPTIONS, INTAKE_FEE_OPTIONS } from "@/lib/payment-intake-rebuild/catalog";
import type {
  IntakeMethodCode,
  IntakeMethodLine,
  IntakeFeeReasonCode,
  IntakeCloseWithFee,
} from "@/lib/payment-intake-rebuild/types";
import "@/components/admin/payment-intake/payment-intake.css";

type Toast = AdminToastFn;

type DebtRow = {
  id: string;
  orderNumber: string | null;
  dateYmd: string;
  week: string | null;
  remainingUsd: number;
  totalAmountUsd: number;
  dbPaidUsd: number;
};

type CustomerHit = { id: string; customerCode: string; nameAr: string | null; nameEn: string | null };

function toCustomerHit(r: {
  id: string;
  code?: string | null;
  label?: string;
  nameAr?: string | null;
  nameEn?: string | null;
}): CustomerHit {
  return {
    id: r.id,
    customerCode: (r.code ?? r.label ?? r.id).trim() || r.id,
    nameAr: r.nameAr ?? null,
    nameEn: r.nameEn ?? null,
  };
}

function newLine(method: IntakeMethodCode = "CASH"): IntakeMethodLine {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    method,
    amount: 0,
    note: "",
    checks: method === "CHECK" ? [{ checkNumber: "", dueDateYmd: formatLocalYmd(new Date()), amount: 0 }] : undefined,
  };
}

function money(n: number): string {
  return roundMoney2(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PaymentIntakeModal({
  financial,
  onToast,
  initialPayment,
}: {
  financial: SerializedFinancial | null;
  onToast: Toast;
  initialPayment?: PaymentWindowProps | null;
  canViewCustomerCard?: boolean;
  canEditOrders?: boolean;
  canCreateOrders?: boolean;
  viewerIsAdmin?: boolean;
  resetOnKey?: string | number;
}) {
  const defaultRate = Number(financial?.finalDollarRate) || 0;
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingDebts, setLoadingDebts] = useState(false);
  const [methods, setMethods] = useState<IntakeMethodLine[]>([newLine("CASH")]);
  const [dollarRate, setDollarRate] = useState(defaultRate > 0 ? defaultRate : 3.5);
  const [weekCode] = useState(ACTIVE_WORK_WEEK_CODE);
  const [paymentDateYmd] = useState(() => formatLocalYmd(new Date()));
  const [paymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const [closeFee, setCloseFee] = useState(false);
  const [feeReason, setFeeReason] = useState<IntakeFeeReasonCode>("BANK_FEE");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDescription, setFeeDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null);

  const loadCustomer = useCallback(async (c: CustomerHit) => {
    setCustomer(c);
    setCustomerHits([]);
    setCustomerQuery(`${c.customerCode} · ${c.nameAr || c.nameEn || ""}`);
    setLoadingDebts(true);
    setErr(null);
    try {
      const res = await fetchPaymentIntakeCustomerOrdersAction(c.id, weekCode, null);
      if (!res.ok) {
        setErr(res.error);
        setDebts([]);
        setSelectedIds(new Set());
        return;
      }
      const rows: DebtRow[] = res.orders
        .map((o) => {
          const remaining = roundMoney2(Math.max(0, Number(o.dbRemainingUsd) || Number(o.totalAmountUsd) - Number(o.dbPaidUsd)));
          return {
            id: o.id,
            orderNumber: o.orderNumber,
            dateYmd: o.dateYmd,
            week: o.week,
            remainingUsd: remaining,
            totalAmountUsd: Number(o.totalAmountUsd) || 0,
            dbPaidUsd: Number(o.dbPaidUsd) || 0,
          };
        })
        .filter((r) => r.remainingUsd > 0.02);
      setDebts(rows);
      const prefer = initialPayment?.orderId?.trim();
      if (prefer && rows.some((r) => r.id === prefer)) {
        setSelectedIds(new Set([prefer]));
      } else {
        setSelectedIds(new Set(rows.map((r) => r.id)));
      }
    } finally {
      setLoadingDebts(false);
    }
  }, [weekCode, initialPayment?.orderId]);

  useEffect(() => {
    if (initialPayment?.customerId) {
      void (async () => {
        const resolved = await searchCustomersPaymentIntakeAction(initialPayment.customerId!);
        const hitRow = resolved.find((x) => x.id === initialPayment.customerId) ?? resolved[0];
        if (hitRow) await loadCustomer(toCustomerHit(hitRow));
      })();
    }
  }, [initialPayment?.customerId, loadCustomer]);

  useEffect(() => {
    const q = customerQuery.trim();
    if (customer || q.length < 1) {
      if (!q) setCustomerHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchCustomersPaymentIntakeAction(q).then((rows) => {
        setCustomerHits(rows.slice(0, 12).map(toCustomerHit));
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [customerQuery, customer]);

  const selectedDebts = useMemo(
    () => debts.filter((d) => selectedIds.has(d.id)),
    [debts, selectedIds],
  );
  const debtUsd = useMemo(
    () => roundMoney2(selectedDebts.reduce((s, d) => s + d.remainingUsd, 0)),
    [selectedDebts],
  );
  const { receivedUsd, totalIls } = useMemo(
    () => computeReceivedUsd(methods, dollarRate),
    [methods, dollarRate],
  );
  const compare = useMemo(
    () => compareReceivedToDebt(debtUsd, receivedUsd),
    [debtUsd, receivedUsd],
  );

  const afterFeeOpen = useMemo(() => {
    if (!closeFee) return compare.openRemainderUsd;
    const feeN = Number(String(feeAmount).replace(",", "."));
    if (!Number.isFinite(feeN) || feeN <= 0) return compare.openRemainderUsd;
    return roundMoney2(Math.max(0, compare.openRemainderUsd - feeN));
  }, [closeFee, feeAmount, compare.openRemainderUsd]);

  function toggleDebt(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateMethod(id: string, patch: Partial<IntakeMethodLine>) {
    setMethods((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        if (patch.method === "CHECK" && !next.checks?.length) {
          next.checks = [{ checkNumber: "", dueDateYmd: formatLocalYmd(new Date()), amount: next.amount || 0 }];
        }
        if (patch.method && patch.method !== "CHECK") next.checks = undefined;
        return next;
      }),
    );
  }

  async function onSave() {
    if (!customer) {
      setErr("יש לבחור לקוח");
      return;
    }
    setBusy(true);
    setErr(null);
    setSavedCode(null);
    try {
      const feePayload: IntakeCloseWithFee | null = closeFee
        ? {
            enabled: true,
            reason: feeReason,
            amountUsd: Number(String(feeAmount).replace(",", ".")) || 0,
            description: feeDescription,
          }
        : null;

      const res = await savePaymentIntakeV2Action({
        customerId: customer.id,
        weekCode,
        paymentDateYmd,
        paymentTimeHm,
        dollarRate,
        selectedOrderIds: [...selectedIds],
        methods,
        closeWithFee: feePayload,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSavedCode(res.saved.primaryPaymentCode);
      onToast(`התשלום נשמר · ${res.saved.primaryPaymentCode}`);
      dispatchCashControlRefresh(weekCode);
      window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
      // איפוס טופס לסכומים — השארת לקוח/חובות מעודכנים
      setMethods([newLine("CASH")]);
      setCloseFee(false);
      setFeeAmount("");
      setFeeDescription("");
      await loadCustomer(customer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pim" dir="rtl">
      <header className="pim-header">
        <div>
          <h1>קליטת תשלום</h1>
          <p>
            שבוע <span dir="ltr">{weekCode}</span> · נרשם מה שהתקבל בפועל
          </p>
        </div>
        {savedCode ? (
          <span className="pim-badge pim-badge--ok" dir="ltr">
            נשמר {savedCode}
          </span>
        ) : null}
      </header>

      {err ? <div className="pim-error">{err}</div> : null}

      <section className="pim-card">
        <h2>1. לקוח</h2>
        <div className="pim-search">
          <input
            type="search"
            placeholder="קוד / שם / טלפון"
            value={customerQuery}
            onChange={(e) => {
              setCustomer(null);
              setCustomerQuery(e.target.value);
            }}
            autoComplete="off"
          />
          {customerHits.length > 0 && !customer ? (
            <ul className="pim-hits">
              {customerHits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => void loadCustomer(h)}>
                    <strong dir="ltr">{h.customerCode}</strong>
                    <span>{h.nameAr || h.nameEn || "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {customer ? (
          <p className="pim-customer-line">
            נבחר: <strong dir="ltr">{customer.customerCode}</strong> · {customer.nameAr || customer.nameEn}
          </p>
        ) : null}
      </section>

      <section className="pim-card">
        <h2>2. בחירת חובות</h2>
        {loadingDebts ? (
          <p className="pim-muted">טוען חובות…</p>
        ) : !customer ? (
          <p className="pim-muted">בחרו לקוח להצגת חובות פתוחים</p>
        ) : debts.length === 0 ? (
          <p className="pim-muted">אין חוב פתוח ללקוח זה</p>
        ) : (
          <>
            <div className="pim-debt-toolbar">
              <button
                type="button"
                className="pim-link"
                onClick={() => setSelectedIds(new Set(debts.map((d) => d.id)))}
              >
                בחר הכל
              </button>
              <button type="button" className="pim-link" onClick={() => setSelectedIds(new Set())}>
                נקה
              </button>
              <span className="pim-muted">
                נבחרו {selectedDebts.length} · סה״כ חוב ${money(debtUsd)}
              </span>
            </div>
            <div className="pim-table-wrap">
              <table className="pim-table">
                <thead>
                  <tr>
                    <th />
                    <th>מסמך</th>
                    <th>תאריך</th>
                    <th>שבוע</th>
                    <th>יתרה פתוחה</th>
                  </tr>
                </thead>
                <tbody>
                  {debts.map((d) => (
                    <tr key={d.id} className={selectedIds.has(d.id) ? "is-selected" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleDebt(d.id)}
                        />
                      </td>
                      <td dir="ltr">{d.orderNumber || d.id.slice(0, 8)}</td>
                      <td dir="ltr">{d.dateYmd}</td>
                      <td dir="ltr">{d.week || "—"}</td>
                      <td dir="ltr">${money(d.remainingUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="pim-card">
        <h2>3. אמצעי תשלום (בפועל)</h2>
        <label className="pim-field pim-field--inline">
          <span>שער דולר</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={dollarRate}
            onChange={(e) => setDollarRate(Number(e.target.value) || 0)}
          />
        </label>
        <div className="pim-methods">
          {methods.map((line) => (
            <div key={line.id} className="pim-method-row">
              <select
                value={line.method}
                onChange={(e) => updateMethod(line.id, { method: e.target.value as IntakeMethodCode })}
              >
                {INTAKE_METHOD_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.labelHe}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="סכום"
                value={line.amount || ""}
                onChange={(e) => updateMethod(line.id, { amount: Number(e.target.value) || 0 })}
              />
              <input
                type="text"
                placeholder="הערה"
                value={line.note || ""}
                onChange={(e) => updateMethod(line.id, { note: e.target.value })}
              />
              <button
                type="button"
                className="pim-link"
                onClick={() => setMethods((prev) => prev.filter((m) => m.id !== line.id))}
                disabled={methods.length <= 1}
              >
                הסר
              </button>
              {line.method === "CHECK" ? (
                <div className="pim-checks">
                  {(line.checks ?? []).map((c, idx) => (
                    <div key={idx} className="pim-check-row">
                      <input
                        placeholder="מס׳ צ׳ק"
                        value={c.checkNumber}
                        onChange={(e) => {
                          const checks = [...(line.checks ?? [])];
                          checks[idx] = { ...c, checkNumber: e.target.value };
                          updateMethod(line.id, { checks });
                        }}
                      />
                      <input
                        type="date"
                        value={c.dueDateYmd}
                        onChange={(e) => {
                          const checks = [...(line.checks ?? [])];
                          checks[idx] = { ...c, dueDateYmd: e.target.value };
                          updateMethod(line.id, { checks });
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="סכום צ׳ק"
                        value={c.amount || ""}
                        onChange={(e) => {
                          const checks = [...(line.checks ?? [])];
                          const amt = Number(e.target.value) || 0;
                          checks[idx] = { ...c, amount: amt };
                          updateMethod(line.id, { checks, amount: checks.reduce((s, x) => s + x.amount, 0) });
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button type="button" className="pim-btn pim-btn--ghost" onClick={() => setMethods((p) => [...p, newLine()])}>
          + אמצעי נוסף
        </button>
      </section>

      <section className="pim-card pim-summary">
        <h2>4. סיכום</h2>
        <div className="pim-summary-grid">
          <div>
            <span>חוב פתוח (נבחר)</span>
            <strong dir="ltr">${money(compare.debtUsd)}</strong>
          </div>
          <div>
            <span>סה״כ התקבל</span>
            <strong dir="ltr">
              ${money(compare.receivedUsd)}
              {totalIls > 0 ? ` · ₪${money(totalIls)}` : ""}
            </strong>
          </div>
          <div>
            <span>יתרה לאחר תשלום</span>
            <strong dir="ltr" className={compare.openRemainderUsd > 0.02 ? "pim-warn" : ""}>
              ${money(afterFeeOpen)}
            </strong>
          </div>
          <div>
            <span>יתרת זכות</span>
            <strong dir="ltr" className={compare.creditSurplusUsd > 0.02 ? "pim-ok" : ""}>
              ${money(compare.creditSurplusUsd)}
            </strong>
          </div>
        </div>
        <p className="pim-muted">
          {compare.mode === "under" && "התשלום קטן מהחוב — ייסגר כמה שניתן, יתרה תישאר פתוחה."}
          {compare.mode === "equal" && "התשלום שווה לחוב — כל החוב ייסגר."}
          {compare.mode === "over" && "התשלום גדול מהחוב — החוב ייסגר והעודף יישמר כיתרת זכות."}
        </p>

        {compare.openRemainderUsd > 0.02 ? (
          <div className="pim-fee">
            <label className="pim-check">
              <input type="checkbox" checked={closeFee} onChange={(e) => setCloseFee(e.target.checked)} />
              סגור יתרה באמצעות עמלה
            </label>
            {closeFee ? (
              <div className="pim-fee-fields">
                <select value={feeReason} onChange={(e) => setFeeReason(e.target.value as IntakeFeeReasonCode)}>
                  {INTAKE_FEE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.labelHe}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  placeholder="סכום עמלה (+/−)"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                />
                <input
                  type="text"
                  placeholder={feeReason === "OTHER" ? "תיאור (חובה)" : "תיאור (אופציונלי)"}
                  value={feeDescription}
                  onChange={(e) => setFeeDescription(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="pim-footer">
        <button type="button" className="pim-btn pim-btn--primary" disabled={busy || !customer} onClick={() => void onSave()}>
          {busy ? "שומר…" : "שמור תשלום"}
        </button>
      </footer>
    </div>
  );
}

export default PaymentIntakeModal;
