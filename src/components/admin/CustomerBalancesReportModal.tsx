"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  listCustomerBalancesReportModalAction,
  type CustomerBalanceOrderPhaseFilter,
  type CustomerBalanceReportModalInput,
  type CustomerBalanceRow,
  type CustomerBalancesPayload,
} from "@/app/admin/balances/actions";
import type { ReportFilters } from "@/app/admin/reports/actions";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { LoadingButton, TableSkeleton } from "@/components/ui/loading";
import type { OrderPhaseUi } from "@/lib/customer-balance-order-status";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { internalSignedToBusiness, parseBalanceAmountString } from "@/lib/customer-balance";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 300;

const WEEK_RE = /^AH-(\d+)$/i;

function weekNumber(code: string): number {
  const m = WEEK_RE.exec(code.trim().toUpperCase());
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function shiftWeekCode(code: string, delta: number): string {
  const base = normalizeAhWeekCode(code) ?? DEFAULT_WEEK_CODE;
  const n = weekNumber(base);
  const next = Number.isFinite(n) ? Math.max(1, Math.floor(n + delta)) : 1;
  return `AH-${next}`;
}

export type CustomerBalancesReportModalProps = {
  reportFilters: ReportFilters;
  title: string;
  onClose: () => void;
  onExportPdf: () => void | Promise<void>;
  onExportExcel: () => void | Promise<void>;
  exportingPdf?: boolean;
  exportingExcel?: boolean;
};

/** תוויות סינון — ערכי backend ללא שינוי */
const PHASE_OPTIONS: Array<{ value: CustomerBalanceOrderPhaseFilter; label: string }> = [
  { value: "ALL", label: "הכל" },
  { value: "READY", label: "מוכן" },
  { value: "IN_PROGRESS", label: "בייצור" },
  { value: "PARTIAL", label: "בטיפול" },
  { value: "DELAYED", label: "בעיה" },
];

const PHASE_BADGE_LABEL: Record<OrderPhaseUi, string> = {
  READY: "מוכן",
  IN_PROGRESS: "בייצור",
  PARTIAL: "בטיפול",
  DELAYED: "בעיה",
};

function phaseBadgeClass(phase: OrderPhaseUi): string {
  switch (phase) {
    case "READY":
      return "adm-cbr-erp-badge adm-cbr-erp-badge--ready";
    case "IN_PROGRESS":
      return "adm-cbr-erp-badge adm-cbr-erp-badge--prod";
    case "PARTIAL":
      return "adm-cbr-erp-badge adm-cbr-erp-badge--care";
    case "DELAYED":
      return "adm-cbr-erp-badge adm-cbr-erp-badge--problem";
    default:
      return "adm-cbr-erp-badge";
  }
}

function rowBalanceIlsNumber(balanceIls: string): number {
  const n = Number(balanceIls.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowSignedIlsNumber(signedIls: string): number {
  const n = Number(signedIls.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function dataRowClass(row: CustomerBalanceRow): string {
  const base = "adm-cbr-erp-data-row";
  const business = internalSignedToBusiness(rowSignedIlsNumber(row.signedIls));
  if (business > 0.01) return `${base} adm-cbr-erp-data-row--debt`;
  if (business < -0.01) return `${base} adm-cbr-erp-data-row--credit`;
  return base;
}

function paymentBadgeClass(flow: CustomerBalanceRow["paymentFlow"]): string {
  if (flow === "NOT_PAID") return "adm-cbr-erp-pay-txt adm-cbr-erp-pay-txt--none";
  if (flow === "PARTIAL" || flow === "LOW_DEBT") return "adm-cbr-erp-pay-txt adm-cbr-erp-pay-txt--partial";
  return "adm-cbr-erp-pay-txt adm-cbr-erp-pay-txt--paid";
}

function paymentLabel(flow: CustomerBalanceRow["paymentFlow"]): string {
  if (flow === "PAID") return "שולם";
  if (flow === "PARTIAL" || flow === "LOW_DEBT") return "חלקי";
  return "ללא תשלום";
}

function OrderPhaseBadges({ row }: { row: CustomerBalanceRow }) {
  const b = row.orderPhaseBuckets;
  if (!b) return <span className="adm-cbr-erp-muted">—</span>;
  const seq: OrderPhaseUi[] = ["READY", "IN_PROGRESS", "PARTIAL", "DELAYED"];
  const out: { n: number; phase: OrderPhaseUi }[] = [];
  for (const p of seq) {
    const n = b[p];
    if (n > 0) out.push({ n, phase: p });
  }
  if (out.length === 0) return <span className="adm-cbr-erp-muted">—</span>;
  return (
    <div className="adm-cbr-erp-phase-badges">
      {out.map(({ n, phase }) => (
        <span key={phase} className={phaseBadgeClass(phase)}>
          {n} {PHASE_BADGE_LABEL[phase]}
        </span>
      ))}
    </div>
  );
}

function toModalInput(
  page: number,
  opts: {
    smart: string;
    orderPhase: CustomerBalanceOrderPhaseFilter;
    minBalanceIls: string;
    maxBalanceIls: string;
    minBalanceUsd: string;
    maxBalanceUsd: string;
    modalWeekCode: string;
    modalToYmd: string;
  },
): CustomerBalanceReportModalInput {
  return {
    page,
    limit: PAGE_SIZE,
    smart: opts.smart.trim() || undefined,
    orderPhase: opts.orderPhase,
    minBalanceIls: opts.minBalanceIls.trim() || undefined,
    maxBalanceIls: opts.maxBalanceIls.trim() || undefined,
    minBalanceUsd: opts.minBalanceUsd.trim() || undefined,
    maxBalanceUsd: opts.maxBalanceUsd.trim() || undefined,
    modalWeekCode: opts.modalWeekCode.trim() || undefined,
    modalToYmd: opts.modalToYmd.trim() || undefined,
  };
}

type TableProps = {
  rows: CustomerBalanceRow[];
  expandedId: string | null;
  onToggleRow: (customerId: string) => void;
};

const BalancesErpTable = memo(function BalancesErpTable({ rows, expandedId, onToggleRow }: TableProps) {
  if (rows.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={5} className="adm-cbr-erp-empty">
            לא נמצאו לקוחות עם יתרה פתוחה בטווח והפילטרים שנבחרו
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <tbody>
      {rows.map((row) => (
        <Fragment key={row.customerId}>
          <tr
            className={dataRowClass(row)}
            onClick={() => onToggleRow(row.customerId)}
            style={{ cursor: "pointer" }}
          >
            <td>
              <div className="adm-cbr-erp-cust-name">{row.customerName}</div>
              {row.customerCode ? <div className="adm-cbr-erp-cust-code">{row.customerCode}</div> : null}
            </td>
            <td className="adm-cbr-erp-num adm-cbr-erp-num--strong">
              <CustomerBalanceView internalSignedRaw={row.signedIls} currency="ILS" />
            </td>
            <td className="adm-cbr-erp-num adm-cbr-erp-num--strong">
              <CustomerBalanceView internalSignedRaw={row.signedUsd} currency="USD" />
            </td>
            <td>
              <span className={paymentBadgeClass(row.paymentFlow)}>{paymentLabel(row.paymentFlow)}</span>
            </td>
            <td>
              <OrderPhaseBadges row={row} />
            </td>
          </tr>
          {expandedId === row.customerId && (row.ordersOpenLines?.length ?? 0) > 0 ? (
            <tr className="adm-cbr-erp-detail-row">
              <td colSpan={5}>
                <div className="adm-cbr-erp-detail-box">
                  {row.ordersOpenLines?.map((line, i) => (
                    <div key={i} className="adm-cbr-erp-detail-line">
                      <span className="adm-cbr-erp-detail-code">{line.lineLabel}</span>
                      <span className={phaseBadgeClass(line.phase)}>{PHASE_BADGE_LABEL[line.phase]}</span>
                      <span className="adm-cbr-erp-detail-usd">{line.amountUsd}</span>
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ) : null}
        </Fragment>
      ))}
    </tbody>
  );
});

export function CustomerBalancesReportModal({
  reportFilters,
  title,
  onClose,
  onExportPdf,
  onExportExcel,
  exportingPdf,
  exportingExcel,
}: CustomerBalancesReportModalProps) {
  const { runWithLoading, isLoading } = useAdminLoading();
  const [payload, setPayload] = useState<CustomerBalancesPayload | null>(null);
  const [page, setPage] = useState(1);
  const [orderPhase, setOrderPhase] = useState<CustomerBalanceOrderPhaseFilter>("ALL");
  const [minBalanceIls, setMinBalanceIls] = useState("");
  const [maxBalanceIls, setMaxBalanceIls] = useState("");
  const [minBalanceUsd, setMinBalanceUsd] = useState("");
  const [maxBalanceUsd, setMaxBalanceUsd] = useState("");
  const [modalWeekCode, setModalWeekCode] = useState("");
  const [modalToYmd, setModalToYmd] = useState("");
  const [smartDraft, setSmartDraft] = useState("");
  const [smartDebounced, setSmartDebounced] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reportKey = useMemo(() => JSON.stringify(reportFilters), [reportFilters]);

  const effectiveWeek = useMemo(
    () =>
      normalizeAhWeekCode(modalWeekCode.trim() || undefined) ??
      normalizeAhWeekCode(reportFilters.workWeek) ??
      DEFAULT_WEEK_CODE,
    [modalWeekCode, reportFilters.workWeek],
  );

  const weekOptions = useMemo(() => {
    const set = new Set<string>(WORK_WEEK_CODES_SORTED);
    set.add(effectiveWeek);
    const maxN = [...set].reduce((m, c) => Math.max(m, weekNumber(c)), 0);
    for (let i = Math.max(1, maxN - 8); i <= maxN + 16; i++) set.add(`AH-${i}`);
    return [...set].sort((a, b) => weekNumber(a) - weekNumber(b));
  }, [effectiveWeek]);

  const weekRangeLabel = useMemo(() => {
    const r = getAhWeekRange(effectiveWeek);
    if (!r) return "";
    const fmt = (ymd: string) => {
      const [y, mo, d] = ymd.split("-");
      return `${d}/${mo}/${y}`;
    };
    return `${fmt(r.from)} - ${fmt(r.to)}`;
  }, [effectiveWeek]);

  useEffect(() => {
    const w = normalizeAhWeekCode(reportFilters.workWeek);
    setModalWeekCode(w ?? "");
    setModalToYmd("");
  }, [reportKey]);

  const modalOpts = useMemo(
    () => ({
      smart: smartDebounced,
      orderPhase,
      minBalanceIls,
      maxBalanceIls,
      minBalanceUsd,
      maxBalanceUsd,
      modalWeekCode,
      modalToYmd,
    }),
    [smartDebounced, orderPhase, minBalanceIls, maxBalanceIls, minBalanceUsd, maxBalanceUsd, modalWeekCode, modalToYmd],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setSmartDebounced(smartDraft.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [smartDraft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await runWithLoading(
          () => listCustomerBalancesReportModalAction(reportFilters, toModalInput(1, modalOpts)),
          { message: "טוען יתרות…", mode: "bar" },
        );
        if (!cancelled) {
          setPayload(next);
          setPage(next.page);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, modalOpts]);

  const goPage = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const next = await runWithLoading(
          () => listCustomerBalancesReportModalAction(reportFilters, toModalInput(nextPage, modalOpts)),
          { message: "טוען עמוד…", mode: "bar" },
        );
        setPayload(next);
        setPage(next.page);
      } finally {
        setLoading(false);
      }
    },
    [reportFilters, modalOpts, runWithLoading],
  );

  const onToggleRow = useCallback((customerId: string) => {
    setExpandedId((id) => (id === customerId ? null : customerId));
  }, []);

  const stats = payload?.reportModalStats;

  const footerTotals = useMemo(() => {
    if (!payload) return null;
    return {
      customers: payload.totalRows,
      ils: payload.stats.totalDebtIls,
      usd: stats?.totalDebtUsd ?? "—",
    };
  }, [payload, stats]);

  return (
    <div className="adm-cbr-erp" dir="rtl">
      <header className="adm-cbr-erp-topbar">
        <h2 className="adm-cbr-erp-topbar__title">{title}</h2>
        <div className="adm-cbr-erp-topbar__actions">
          <LoadingButton
            type="button"
            className="adm-cbr-erp-export-btn"
            loading={!!exportingExcel}
            loadingLabel="מייצא…"
            disabled={isLoading}
            onClick={() => void onExportExcel()}
          >
            Excel
          </LoadingButton>
          <LoadingButton
            type="button"
            className="adm-cbr-erp-export-btn"
            loading={!!exportingPdf}
            loadingLabel="מכין…"
            disabled={isLoading}
            onClick={() => void onExportPdf()}
          >
            PDF
          </LoadingButton>
          <button type="button" className="adm-cbr-erp-close" onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
      </header>

      <section className="adm-cbr-erp-week-strip" aria-label="שבוע עבודה">
        <div className="adm-cbr-erp-ah-card" dir="ltr">
          <button
            type="button"
            className="adm-cbr-erp-ah-arrow"
            aria-label="שבוע קודם"
            disabled={isLoading || loading}
            onClick={() => setModalWeekCode(shiftWeekCode(effectiveWeek, -1))}
          >
            &lt;
          </button>
          <select
            className="adm-cbr-erp-ah-chip"
            aria-label="בחירת שבוע AH"
            disabled={isLoading || loading}
            value={effectiveWeek}
            onChange={(e) => setModalWeekCode(e.target.value)}
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="adm-cbr-erp-ah-arrow"
            aria-label="שבוע הבא"
            disabled={isLoading || loading}
            onClick={() => setModalWeekCode(shiftWeekCode(effectiveWeek, 1))}
          >
            &gt;
          </button>
        </div>
        <p className="adm-cbr-erp-week-dates">{weekRangeLabel}</p>
      </section>

      {stats ? (
        <div className="adm-cbr-erp-kpis" role="region" aria-label="מדדים">
          <div className="adm-cbr-erp-kpi adm-cbr-erp-kpi--violet">
            <span className="adm-cbr-erp-kpi__label">סה״כ חייבים</span>
            <strong className="adm-cbr-erp-kpi__value">{stats.totalDebtUsd}</strong>
          </div>
          <div className="adm-cbr-erp-kpi adm-cbr-erp-kpi--orange">
            <span className="adm-cbr-erp-kpi__label">לקוחות בטיפול</span>
            <strong className="adm-cbr-erp-kpi__value">{stats.customersInTreatment}</strong>
          </div>
          <div className="adm-cbr-erp-kpi adm-cbr-erp-kpi--red">
            <span className="adm-cbr-erp-kpi__label">לקוחות ללא תשלום</span>
            <strong className="adm-cbr-erp-kpi__value">{stats.customersNoPayment}</strong>
          </div>
          <div className="adm-cbr-erp-kpi adm-cbr-erp-kpi--green">
            <span className="adm-cbr-erp-kpi__label">הזמנות מוכנות שלא שולמו</span>
            <strong className="adm-cbr-erp-kpi__value">{stats.readyUnpaidOrdersCount}</strong>
          </div>
        </div>
      ) : null}

      <section className="adm-cbr-erp-filters" aria-label="סינון">
        <div className="adm-cbr-erp-filters__row adm-cbr-erp-filters__row--single">
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">סטטוס הזמנה</span>
            <select
              className="adm-cbr-erp-input"
              value={orderPhase}
              disabled={isLoading || loading}
              onChange={(e) => setOrderPhase(e.target.value as CustomerBalanceOrderPhaseFilter)}
            >
              {PHASE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">מינ׳ ₪</span>
            <input
              className="adm-cbr-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading || loading}
              value={minBalanceIls}
              onChange={(e) => setMinBalanceIls(e.target.value)}
            />
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">מקס׳ ₪</span>
            <input
              className="adm-cbr-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading || loading}
              value={maxBalanceIls}
              onChange={(e) => setMaxBalanceIls(e.target.value)}
            />
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">מינ׳ $</span>
            <input
              className="adm-cbr-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading || loading}
              value={minBalanceUsd}
              onChange={(e) => setMinBalanceUsd(e.target.value)}
            />
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">מקס׳ $</span>
            <input
              className="adm-cbr-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading || loading}
              value={maxBalanceUsd}
              onChange={(e) => setMaxBalanceUsd(e.target.value)}
            />
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--weeksel">
            <span className="adm-cbr-erp-field__label">שבוע AH</span>
            <select
              className="adm-cbr-erp-input adm-cbr-erp-input--week-mini"
              disabled={isLoading || loading}
              value={effectiveWeek}
              onChange={(e) => setModalWeekCode(e.target.value)}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--tight">
            <span className="adm-cbr-erp-field__label">עד תאריך</span>
            <input
              className="adm-cbr-erp-input"
              type="date"
              disabled={isLoading || loading}
              value={modalToYmd}
              onChange={(e) => setModalToYmd(e.target.value)}
            />
          </label>
          <label className="adm-cbr-erp-field adm-cbr-erp-field--search">
            <span className="adm-cbr-erp-field__label">חיפוש</span>
            <input
              className="adm-cbr-erp-input"
              type="search"
              placeholder="חיפוש שם, קוד, טלפון..."
              disabled={isLoading || loading}
              value={smartDraft}
              onChange={(e) => setSmartDraft(e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="adm-cbr-erp-scroll">
        {loading || !payload ? (
          <div className="adm-cbr-erp-table-shell" aria-busy>
            <table className="adm-cbr-erp-table">
              <thead>
                <tr>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <th key={i}>‎</th>
                  ))}
                </tr>
              </thead>
              <TableSkeleton rows={8} columns={5} />
            </table>
          </div>
        ) : (
          <div className="adm-cbr-erp-table-shell">
            <table className="adm-cbr-erp-table">
              <thead>
                <tr>
                  <th>לקוח</th>
                  <th>יתרה ₪</th>
                  <th>יתרה $</th>
                  <th>תשלומים</th>
                  <th>סטטוס הזמנות</th>
                </tr>
              </thead>
              <BalancesErpTable rows={payload.rows} expandedId={expandedId} onToggleRow={onToggleRow} />
            </table>
          </div>
        )}
      </div>

      {footerTotals ? (
        <footer className="adm-cbr-erp-footer">
          <div className="adm-cbr-erp-footer__sums">
            <div className="adm-cbr-erp-footer__cell adm-cbr-erp-footer__cell--right">
              <span className="adm-cbr-erp-footer__k">סה״כ לקוחות</span>
              <strong className="adm-cbr-erp-footer__v">{footerTotals.customers}</strong>
            </div>
            <div className="adm-cbr-erp-footer__cell adm-cbr-erp-footer__cell--center">
              <span className="adm-cbr-erp-footer__k">סה״כ ₪</span>
              <strong className="adm-cbr-erp-footer__v">{footerTotals.ils}</strong>
            </div>
            <div className="adm-cbr-erp-footer__cell adm-cbr-erp-footer__cell--left">
              <span className="adm-cbr-erp-footer__k">סה״כ $</span>
              <strong className="adm-cbr-erp-footer__v">{footerTotals.usd}</strong>
            </div>
          </div>
          <div className="adm-cbr-erp-footer__page">
            <button
              type="button"
              className="adm-cbr-erp-page-mini"
              disabled={isLoading || loading || page <= 1}
              aria-label="עמוד קודם"
              onClick={() => void goPage(page - 1)}
            >
              &lt;
            </button>
            <span className="adm-cbr-erp-page-mini-num">{page}</span>
            <button
              type="button"
              className="adm-cbr-erp-page-mini"
              disabled={isLoading || loading || !payload || page >= payload.totalPages}
              aria-label="עמוד הבא"
              onClick={() => void goPage(page + 1)}
            >
              &gt;
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
