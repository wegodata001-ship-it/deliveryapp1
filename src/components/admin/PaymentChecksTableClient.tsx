"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaymentCheckRowDTO, PaymentCheckListResult } from "@/lib/payment-checks-admin";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 400;

function fmtUsd(n: string): string {
  const x = Number(n.replace(/,/g, ""));
  if (!Number.isFinite(x)) return n;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(x);
}

function statusBadgeClass(s: string): string {
  if (s === "PENDING") return "adm-pc-badge adm-pc-badge--pending";
  if (s === "DEPOSITED") return "adm-pc-badge adm-pc-badge--deposited";
  if (s === "BOUNCED") return "adm-pc-badge adm-pc-badge--bounced";
  return "adm-pc-badge";
}

export function PaymentChecksTableClient() {
  const { openWindow } = useAdminWindows();
  const [data, setData] = useState<PaymentCheckListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [customer, setCustomer] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [week, setWeek] = useState("");
  const [sortKey, setSortKey] = useState("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  /** סינון מהיר (לא שובר pagination — נשלח לשרת) */
  const [quick, setQuick] = useState("");
  const gen = useRef(0);
  const cacheRef = useRef(new Map<string, { ts: number; data: PaymentCheckListResult }>());

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(PAGE_LIMIT));
    if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
    if (status) p.set("status", status);
    if (dueFrom) p.set("dueFrom", dueFrom);
    if (dueTo) p.set("dueTo", dueTo);
    if (customer.trim()) p.set("customer", customer.trim());
    if (checkNumber.trim()) p.set("checkNumber", checkNumber.trim());
    if (week.trim()) p.set("week", week.trim());
    if (quick) p.set("quick", quick);
    if (sortKey) p.set("sortKey", sortKey);
    p.set("sortDir", sortDir);
    return p.toString();
  }, [page, debouncedSearch, quick, status, dueFrom, dueTo, customer, checkNumber, week, sortKey, sortDir]);

  const load = useCallback(async () => {
    const seq = ++gen.current;
    const key = queryString;
    const hit = cacheRef.current.get(key);
    if (hit && Date.now() - hit.ts < 30_000) {
      setData(hit.data);
      setPage(hit.data.page);
      setLoading(false);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/payment-checks?${key}`, { cache: "no-store" });
      const raw = await res.json();
      if (gen.current !== seq) return;
      if (!res.ok) {
        setErr(typeof raw?.error === "string" ? raw.error : "טעינה נכשלה");
        setData(null);
        return;
      }
      const parsed = raw as PaymentCheckListResult;
      cacheRef.current.set(key, { ts: Date.now(), data: parsed });
      setData(parsed);
      setPage(parsed.page);
      if (parsed.page < parsed.totalPages) {
        const nextQs = new URLSearchParams(key);
        nextQs.set("page", String(parsed.page + 1));
        const nk = nextQs.toString();
        if (!cacheRef.current.has(nk)) {
          window.setTimeout(() => {
            void fetch(`/api/payment-checks?${nk}`, { cache: "no-store" }).then(async (r2) => {
              if (!r2.ok) return;
              const j = (await r2.json()) as PaymentCheckListResult;
              cacheRef.current.set(nk, { ts: Date.now(), data: j });
            });
          }, 0);
        }
      }
    } catch {
      if (gen.current !== seq) return;
      setErr("שגיאת רשת");
      setData(null);
    } finally {
      if (gen.current === seq) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, quick, status, dueFrom, dueTo, customer, checkNumber, week, sortKey, sortDir]);

  async function patchStatus(id: string, next: "DEPOSITED" | "BOUNCED") {
    if (next === "BOUNCED") {
      const ok = window.confirm("לסמן את הצ׳יק כ״חזר״? יירשם תשלום הפוך (שלילי) כדי להחזיר יתרה לחוב, והשורה תסומן באדום.");
      if (!ok) return;
    }
    setRowErr(null);
    const res = await fetch("/api/payment-checks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRowErr(typeof raw?.error === "string" ? raw.error : "עדכון נכשל");
      return;
    }
    cacheRef.current.clear();
    await load();
  }

  function openIntake(row: PaymentCheckRowDTO) {
    openWindow({ type: "paymentsUpdated", props: { paymentId: row.paymentId } });
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  const st = data?.stats;

  function setQuickChip(next: string) {
    setQuick(next);
    if (next === "deposited" || next === "bounced") setStatus("");
  }

  function rowHighlightClass(h: PaymentCheckRowDTO["dueHighlight"]): string {
    if (h === "soon") return "adm-pc-row--soon";
    if (h === "today") return "adm-pc-row--today";
    if (h === "overdue") return "adm-pc-row--overdue";
    return "";
  }

  return (
    <div className="adm-pc-page">
      <div className="adm-pc-summary-grid">
        <div className="adm-pc-summary-card">
          <span className="adm-pc-summary-lbl">סה״כ צ׳יקים</span>
          <span className="adm-pc-summary-val">{st ? st.totalCount : "—"}</span>
        </div>
        <div className="adm-pc-summary-card">
          <span className="adm-pc-summary-lbl">סכום כולל</span>
          <span className="adm-pc-summary-val" dir="ltr">
            {st ? `$${fmtUsd(st.totalAmountUsd)}` : "—"}
          </span>
        </div>
        <div className="adm-pc-summary-card">
          <span className="adm-pc-summary-lbl">ממתינים לפרעון</span>
          <span className="adm-pc-summary-val">{st ? st.pendingCount : "—"}</span>
        </div>
        <div className="adm-pc-summary-card">
          <span className="adm-pc-summary-lbl">צ׳יקים שחזרו</span>
          <span className="adm-pc-summary-val">{st ? st.bouncedCount : "—"}</span>
        </div>
      </div>

      <div className="adm-pc-summary-grid adm-pc-summary-grid--kpi">
        <div className="adm-pc-summary-card adm-pc-summary-card--soon">
          <span className="adm-pc-summary-lbl">צ׳יקים קרובים</span>
          <span className="adm-pc-summary-val">{st ? st.dueNext7NotDepositedCount : "—"}</span>
          <span className="adm-pc-summary-sub">פרעון ב־7 ימים הקרובים</span>
        </div>
        <div className="adm-pc-summary-card adm-pc-summary-card--today">
          <span className="adm-pc-summary-lbl">צ׳יקים היום</span>
          <span className="adm-pc-summary-val">{st ? st.dueTodayNotDepositedCount : "—"}</span>
          <span className="adm-pc-summary-sub">פרעון היום (לא הופקד)</span>
        </div>
        <div className="adm-pc-summary-card adm-pc-summary-card--overdue">
          <span className="adm-pc-summary-lbl">צ׳יקים באיחור</span>
          <span className="adm-pc-summary-val">{st ? st.overduePendingCount : "—"}</span>
          <span className="adm-pc-summary-sub">ממתין ותאריך פרעון חלף</span>
        </div>
      </div>

      {st?.needsAttention ? (
        <div className="adm-pc-attention-banner" role="status">
          <span className="adm-pc-attention-dot" aria-hidden />
          יש צ׳יקים הדורשים טיפול — פרעון היום או באיחור (ממתין)
        </div>
      ) : null}

      <div className="adm-pc-quick-chips adm-source-pro-toolbar--sticky">
        <span className="adm-pc-quick-chips-lbl">סינון מהיר:</span>
        {(
          [
            { key: "", label: "הכל" },
            { key: "close7", label: "קרובים לפרעון" },
            { key: "today", label: "היום" },
            { key: "week", label: "השבוע" },
            { key: "overdue", label: "באיחור" },
            { key: "deposited", label: "הופקדו" },
            { key: "bounced", label: "חזרו" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key || "all"}
            type="button"
            className={["adm-pc-chip", quick === key ? "adm-pc-chip--active" : ""].filter(Boolean).join(" ")}
            onClick={() => {
              if (key === "") {
                setQuick("");
                return;
              }
              if (key === "deposited" || key === "bounced") {
                setQuickChip(key);
                return;
              }
              setQuick(quick === key ? "" : key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="adm-source-pro-toolbar adm-pc-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש חכם: מס׳ צ׳יק, לקוח, קוד לקוח, קוד תשלום, שבוע AH, הערות…"
          disabled={loading && !data}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          סינון מתקדם
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void load()} disabled={loading && !data}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters adm-pc-filters">
          <label>
            סטטוס
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">הכל</option>
              <option value="PENDING">ממתין</option>
              <option value="DEPOSITED">הופקד</option>
              <option value="BOUNCED">חזר</option>
            </select>
          </label>
          <label>
            מתאריך פרעון
            <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
          </label>
          <label>
            עד תאריך פרעון
            <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
          </label>
          <label>
            לקוח (שם / קוד)
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="שם או קוד לקוח" />
          </label>
          <label>
            מס׳ צ׳יק
            <input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="מספר צ׳יק" />
          </label>
          <label>
            שבוע AH
            <input value={week} onChange={(e) => setWeek(e.target.value)} placeholder="AH-118" dir="ltr" />
          </label>
        </div>
      ) : null}

      {rowErr ? <div className="adm-error">{rowErr}</div> : null}
      {err ? <TableError message={err} onRetry={() => void load()} /> : null}

      <div className={["adm-source-pro-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        <table className="adm-table adm-source-pro-table adm-pc-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("checkNumber")}>
                  מס׳ צ׳יק{sortKey === "checkNumber" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("customer")}>
                  לקוח{sortKey === "customer" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>קוד לקוח</th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("amount")}>
                  סכום ($){sortKey === "amount" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("dueDate")}>
                  תאריך פרעון{sortKey === "dueDate" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>ימים לפרעון</th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("status")}>
                  סטטוס{sortKey === "status" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("paymentCode")}>
                  קוד תשלום{sortKey === "paymentCode" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>
                <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("week")}>
                  שבוע AH{sortKey === "week" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton columnCount={10} rowCount={8} />
            ) : !data || data.rows.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <TableEmpty />
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr
                  key={r.id}
                  className={[
                    "adm-source-pro-row",
                    r.status === "BOUNCED" ? "adm-pc-row--bounced" : "",
                    rowHighlightClass(r.dueHighlight),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td dir="ltr">{r.checkNumber}</td>
                  <td>{r.customerName}</td>
                  <td dir="ltr">{r.customerCode}</td>
                  <td dir="ltr">${fmtUsd(r.amountUsd)}</td>
                  <td dir="ltr">{r.dueYmd}</td>
                  <td className="adm-pc-days-cell">{r.daysToDueLabel}</td>
                  <td>
                    <span className={statusBadgeClass(r.status)}>{r.statusLabel}</span>
                  </td>
                  <td dir="ltr">{r.paymentCodeDisplay}</td>
                  <td dir="ltr">{r.weekCode}</td>
                  <td>
                    <div className="adm-pc-actions">
                      <select
                        className="adm-pc-status-select"
                        aria-label="פעולות מהירות על צ׳יק"
                        value=""
                        onChange={(e) => {
                          const v = e.target.value as "" | "intake" | "DEPOSITED" | "BOUNCED";
                          e.target.value = "";
                          if (v === "intake") openIntake(r);
                          else if (v === "DEPOSITED" || v === "BOUNCED") void patchStatus(r.id, v);
                        }}
                      >
                        <option value="">פעולות מהירות…</option>
                        <option value="intake">פתח קליטת תשלום</option>
                        {r.status === "PENDING" ? <option value="DEPOSITED">סמן כהופקד</option> : null}
                        {r.status !== "BOUNCED" ? <option value="BOUNCED">סמן כחזר</option> : null}
                      </select>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data ? (
        <div className="adm-source-pro-pagination">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            הקודם
          </button>
          <span>
            {data.page} / {data.totalPages}
          </span>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={data.page >= data.totalPages || loading}
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
          >
            הבא
          </button>
        </div>
      ) : null}
    </div>
  );
}
