"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  listCustomerBalancesAction,
  updateCustomerBalanceNoteAction,
  updateCustomerBalanceStatusAction,
  type CustomerBalanceRow,
  type CustomerBalanceStatus,
  type CustomerBalancesPayload,
} from "@/app/admin/balances/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

const LIMIT = 15;

const STATUS_LABELS: Record<CustomerBalanceStatus, string> = {
  NOT_PAID: "לא שולם",
  PARTIAL: "שולם חלקית",
  PAID: "שולם במלואו",
  PROBLEM: "חוב בעייתי",
  PAUSED: "מושהה",
};

function money(prefix: string, value: string): string {
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n)) return `${prefix} ${value}`;
  return `${prefix} ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dec(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function renderBalanceText(value: string): { badge: string; className: string; text: string } {
  const n = dec(value);
  const pretty = `₪ ${Math.abs(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n > 0) return { badge: "🟥 חוב", className: "adm-balance-kind adm-balance-kind--debt", text: `${pretty} צריך לשלם` };
  if (n < 0) return { badge: "🟩 זכות", className: "adm-balance-kind adm-balance-kind--credit", text: `${pretty} זכות ללקוח` };
  return { badge: "מאוזן", className: "adm-balance-kind adm-balance-kind--even", text: "₪ 0.00 מאוזן" };
}

function renderCreditText(value: string): string {
  const n = Math.abs(dec(value));
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} זכות ללקוח`;
}

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 1, totalPages - 2));
  const end = Math.min(totalPages, start + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function CustomerBalancesClient() {
  const { openWindow } = useAdminWindows();
  const { runWithLoading, isLoading } = useAdminLoading();
  const sp = useSearchParams();
  const [payload, setPayload] = useState<CustomerBalancesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CustomerBalanceStatus | "">("");
  const [debounced, setDebounced] = useState({ name: "", code: "", status: "" as CustomerBalanceStatus | "" });
  const [err, setErr] = useState<string | null>(null);
  const fromYmd = sp.get("from") || undefined;
  const toYmd = sp.get("to") || undefined;
  const weekCode = sp.get("week") || undefined;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced({ name, code, status });
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [name, code, status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void runWithLoading(
      () =>
        listCustomerBalancesAction({
          page,
          limit: LIMIT,
          fromYmd,
          toYmd,
          weekCode,
          filters: debounced,
        }),
      "טוען יתרות...",
    )
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, debounced, fromYmd, toYmd, weekCode, runWithLoading]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  function openLedger(row: CustomerBalanceRow) {
    openWindow({
      type: "customerCard",
      props: { customerId: row.customerId, customerName: row.customerName, initialTab: "ledger" },
    });
  }

  function openPayment(row: CustomerBalanceRow) {
    openWindow({
      type: "payments",
      props: {
        customerId: row.customerId,
        customerName: row.customerName,
        amountIls: row.balanceILS,
      },
    });
  }

  async function changeStatus(row: CustomerBalanceRow, next: CustomerBalanceStatus) {
    if (isLoading) return;
    setErr(null);
    setPayload((old) =>
      old
        ? {
            ...old,
            rows: old.rows.map((r) =>
              r.customerId === row.customerId ? { ...r, status: next, statusOverride: next } : r,
            ),
          }
        : old,
    );
    const res = await runWithLoading(
      () => updateCustomerBalanceStatusAction(row.customerId, next),
      "שומר סטטוס יתרה...",
    );
    if (!res.ok) {
      setErr(res.error);
      setPage((p) => p);
    }
  }

  async function changeNote(row: CustomerBalanceRow, note: string) {
    setErr(null);
    setPayload((old) =>
      old
        ? {
            ...old,
            rows: old.rows.map((r) => (r.customerId === row.customerId ? { ...r, note } : r)),
          }
        : old,
    );
  }

  async function saveNote(row: CustomerBalanceRow, note: string) {
    if (isLoading) return;
    const res = await runWithLoading(
      () => updateCustomerBalanceNoteAction(row.customerId, note),
      "שומר הערה...",
    );
    if (!res.ok) setErr(res.error);
  }

  return (
    <div className="adm-balances-page">
      <div className="adm-balances-head">
        <div>
          <h1>יתרת לקוחות</h1>
          <p>תצוגה מודרנית ללקוחות, יתרות וסטטוס גבייה, בלי לשנות את מבנה הנתונים הישן.</p>
        </div>
      </div>

      {err ? <div className="adm-error">{err}</div> : null}

      <div className="adm-balances-filters">
        <label>
          חיפוש לפי שם
          <input disabled={isLoading} value={name} onChange={(e) => setName(e.target.value)} placeholder="customerName" />
        </label>
        <label>
          חיפוש לפי קוד
          <input disabled={isLoading} value={code} onChange={(e) => setCode(e.target.value)} placeholder="customerCode" dir="ltr" />
        </label>
        <label>
          סינון לפי סטטוס
          <select disabled={isLoading} value={status} onChange={(e) => setStatus(e.target.value as CustomerBalanceStatus | "")}>
            <option value="">הכל</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="adm-balances-table-wrap" aria-busy={loading}>
        {loading ? <div className="adm-balances-loading">טוען…</div> : null}
        <table className="adm-table adm-balances-table">
          <thead>
            <tr>
              <th>שם לקוח</th>
              <th>קוד לקוח</th>
              <th>סה"כ הזמנות</th>
              <th>סה"כ תשלומים (קשורים)</th>
              <th>סה"כ זיכויים</th>
              <th>יתרה בשקלים</th>
              <th>יתרה בדולר</th>
              <th>סטטוס יתרה</th>
              <th>סטטוס גבייה</th>
              <th>הערות</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={11}>
                    <div className="adm-skeleton-line" />
                  </td>
                </tr>
              ))
            ) : !payload || payload.rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="adm-table-empty">אין נתונים לטווח שנבחר</td>
              </tr>
            ) : (
              payload.rows.map((row) => {
                const balanceView = renderBalanceText(row.balanceILS);
                const canReceivePayment = dec(row.balanceILS) > 0;
                const hasCredits = dec(row.totalCreditsILS) > 0;
                return (
                <tr key={row.customerId} className={`adm-balance-row adm-balance-row--${row.status.toLowerCase()}`}>
                  <td>
                    <button type="button" className="adm-balance-link" onClick={() => openLedger(row)}>
                      {row.customerName}
                    </button>
                  </td>
                  <td dir="ltr">{row.customerCode ?? "—"}</td>
                  <td><span dir="ltr">{money("₪", row.totalOrdersILS)}</span></td>
                  <td><span dir="ltr">{money("₪", row.totalPaymentsILS)}</span></td>
                  <td>
                    {hasCredits ? <span className="adm-balance-kind adm-balance-kind--credit">🟩 {renderCreditText(row.totalCreditsILS)}</span> : "—"}
                  </td>
                  <td>
                    <button type="button" className="adm-balance-amount" onClick={() => openPayment(row)} disabled={!canReceivePayment}>
                      {row.noOrdersInRange ? (
                        hasCredits ? (
                          <span className="adm-balance-kind adm-balance-kind--credit">לא קיימות הזמנות בטווח זה · {renderCreditText(row.totalCreditsILS)}</span>
                        ) : (
                          <span className="adm-balance-kind adm-balance-kind--even">לא קיימות הזמנות בטווח זה</span>
                        )
                      ) : (
                        <>
                          <span className={balanceView.className}>{balanceView.badge}</span>
                          <span>{balanceView.text}</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td dir="ltr">{money("$", row.balanceUSD)}</td>
                  <td>
                    {row.noOrdersInRange && hasCredits ? (
                      <span className="adm-balance-kind adm-balance-kind--credit">🟩 זכות</span>
                    ) : (
                      <span className={balanceView.className}>{balanceView.badge}</span>
                    )}
                  </td>
                  <td>
                    <select
                      disabled={isLoading}
                      className={`adm-balance-status-select adm-balance-status-select--${row.status.toLowerCase()}`}
                      value={row.status}
                      onChange={(e) => void changeStatus(row, e.target.value as CustomerBalanceStatus)}
                    >
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <textarea
                      disabled={isLoading}
                      className="adm-balance-note-input"
                      value={row.note}
                      onChange={(e) => void changeNote(row, e.target.value)}
                      onBlur={(e) => void saveNote(row, e.target.value)}
                      placeholder="הוספת הערה..."
                      rows={2}
                    />
                  </td>
                  <td>
                    <div className="adm-balance-actions">
                      <button type="button" disabled={isLoading} className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => openLedger(row)} title={`כרטסת: ${row.customerName}`}>
                        כרטסת 📊
                      </button>
                      {canReceivePayment ? (
                        <button type="button" disabled={isLoading} className="adm-btn adm-btn--ghost adm-btn--xs adm-balance-pay-btn" onClick={() => openPayment(row)}>
                          💸 קליטת תשלום
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-balances-pagination">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={isLoading || (payload?.page ?? page) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={p === (payload?.page ?? page) ? "adm-page-btn adm-page-btn--active" : "adm-page-btn"}
            onClick={() => !isLoading && setPage(p)}
            disabled={isLoading}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={isLoading || (payload?.page ?? page) >= (payload?.totalPages ?? 1)}
          onClick={() => setPage((p) => Math.min(payload?.totalPages ?? 1, p + 1))}
        >
          Next
        </button>
        <span className="adm-balances-page-meta">{payload?.totalRows ?? 0} לקוחות</span>
      </div>
    </div>
  );
}
