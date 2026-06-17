"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OS } from "@/lib/order-status-slugs";
import {
  listOpenOrdersReportModalAction,
  type OpenOrderModalRow,
  type OpenOrdersModalPayload,
  type OpenOrdersModalQuery,
  type OpenOrdersModalStatusBucket,
} from "@/app/admin/reports/open-orders-modal-actions";
import type { ReportFilters } from "@/app/admin/reports/actions";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { LoadingButton, TableSkeleton } from "@/components/ui/loading";
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

const IN_CARE: string[] = [
  OS.WAITING_FOR_EXECUTION,
  OS.WITHDRAWAL_FROM_SUPPLIER,
  OS.SENT,
  OS.WAITING_FOR_CHINA_EXECUTION,
  OS.DEBT_WITHDRAWAL,
];

const STATUS_OPTIONS: Array<{ value: OpenOrdersModalStatusBucket; label: string }> = [
  { value: "ALL", label: "פתוח" },
  { value: "PARTIAL_PAY", label: "חלקי" },
  { value: "IN_CARE", label: "ממתין לביצוע" },
  { value: "COMPLETED", label: "בוצע" },
  { value: "CANCELLED", label: "מבוטל" },
];

export type OpenOrdersReportModalProps = {
  reportFilters: ReportFilters;
  title: string;
  onClose: () => void;
  onExportPdf: () => void | Promise<void>;
  onExportExcel: () => void | Promise<void>;
  exportingPdf?: boolean;
  exportingExcel?: boolean;
};

function toModalQuery(page: number, opts: Omit<OpenOrdersModalQuery, "page">): OpenOrdersModalQuery {
  return { page, ...opts };
}

function statusBadgeClass(status: string): string {
  if (status === OS.COMPLETED) return "adm-oor-erp-badge adm-oor-erp-badge--ready";
  if (status === OS.CANCELLED) return "adm-oor-erp-badge adm-oor-erp-badge--cancel";
  if (IN_CARE.includes(status)) return "adm-oor-erp-badge adm-oor-erp-badge--care";
  if (status === OS.OPEN) return "adm-oor-erp-badge adm-oor-erp-badge--open";
  return "adm-oor-erp-badge";
}

function rowClass(row: OpenOrderModalRow): string {
  const base = "adm-oor-erp-data-row";
  if (row.paymentLabel === "חלקי") return `${base} adm-oor-erp-data-row--partial`;
  if (row.status === OS.COMPLETED) return `${base} adm-oor-erp-data-row--ready`;
  if (IN_CARE.includes(row.status)) return `${base} adm-oor-erp-data-row--care`;
  if (row.status === OS.CANCELLED) return `${base} adm-oor-erp-data-row--cancel`;
  return `${base} adm-oor-erp-data-row--open`;
}

function paymentClass(label: OpenOrderModalRow["paymentLabel"]): string {
  if (label === "ללא תשלום") return "adm-oor-erp-pay adm-oor-erp-pay--none";
  if (label === "חלקי") return "adm-oor-erp-pay adm-oor-erp-pay--partial";
  return "adm-oor-erp-pay adm-oor-erp-pay--paid";
}

type TableBodyProps = {
  rows: OpenOrderModalRow[];
  busy: boolean;
};

const OpenOrdersErpTableBody = memo(function OpenOrdersErpTableBody({ rows, busy }: TableBodyProps) {
  if (busy) {
    return (
      <tbody>
        <TableSkeleton rows={10} columns={8} />
      </tbody>
    );
  }
  if (rows.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={8} className="adm-oor-erp-empty">
            לא נמצאו הזמנות בפילטרים שנבחרו
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className={rowClass(row)}>
          <td className="adm-oor-erp-mono">{row.orderNumber}</td>
          <td>
            <div className="adm-oor-erp-cust">{row.customerName}</div>
          </td>
          <td className="adm-oor-erp-mono adm-oor-erp-week">{row.weekCode}</td>
          <td className="adm-oor-erp-num">{row.totalUsd}</td>
          <td className="adm-oor-erp-num">{row.totalIls}</td>
          <td>
            <span className={statusBadgeClass(row.status)}>{row.statusLabel}</span>
          </td>
          <td>
            <span className={paymentClass(row.paymentLabel)}>{row.paymentLabel}</span>
          </td>
          <td className="adm-oor-erp-mono adm-oor-erp-date">{row.orderDateYmd}</td>
        </tr>
      ))}
    </tbody>
  );
});

export function OpenOrdersReportModal({
  reportFilters,
  title,
  onClose,
  onExportPdf,
  onExportExcel,
  exportingPdf,
  exportingExcel,
}: OpenOrdersReportModalProps) {
  const { runWithLoading, isLoading } = useAdminLoading();
  const [payload, setPayload] = useState<OpenOrdersModalPayload | null>(null);
  const [page, setPage] = useState(1);
  const [statusBucket, setStatusBucket] = useState<OpenOrdersModalStatusBucket>("ALL");
  const [modalWeekCode, setModalWeekCode] = useState("");
  const [modalFromYmd, setModalFromYmd] = useState("");
  const [modalToYmd, setModalToYmd] = useState("");
  const [minUsd, setMinUsd] = useState("");
  const [maxUsd, setMaxUsd] = useState("");
  const [smartDraft, setSmartDraft] = useState("");
  const [smartDebounced, setSmartDebounced] = useState("");
  const [bootLoading, setBootLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const seenFirst = useRef(false);

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
    setModalFromYmd(reportFilters.dateFrom ?? "");
    setModalToYmd(reportFilters.dateTo ?? "");
    setPage(1);
  }, [reportKey]);

  const modalOpts = useMemo(
    () => ({
      smart: smartDebounced,
      statusBucket,
      weekCode: modalWeekCode.trim() || undefined,
      fromYmd: modalFromYmd.trim() || undefined,
      toYmd: modalToYmd.trim() || undefined,
      minUsd: minUsd.trim() || undefined,
      maxUsd: maxUsd.trim() || undefined,
    }),
    [smartDebounced, statusBucket, modalWeekCode, modalFromYmd, modalToYmd, minUsd, maxUsd],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setSmartDebounced(smartDraft.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [smartDraft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = !seenFirst.current;
      if (first) {
        setBootLoading(true);
        seenFirst.current = true;
      } else {
        setTableLoading(true);
      }
      try {
        const next = await runWithLoading(
          () =>
            listOpenOrdersReportModalAction(
              reportFilters,
              toModalQuery(1, { ...modalOpts, limit: PAGE_SIZE }),
            ),
          { message: first ? "טוען דוח…" : "מעדכן טבלה…", mode: "bar" },
        );
        if (!cancelled) {
          setPayload(next);
          setPage(next.page);
        }
      } finally {
        if (!cancelled) {
          setBootLoading(false);
          setTableLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, modalOpts]);

  const goPage = useCallback(
    async (nextPage: number) => {
      setTableLoading(true);
      try {
        const next = await runWithLoading(
          () =>
            listOpenOrdersReportModalAction(
              reportFilters,
              toModalQuery(nextPage, { ...modalOpts, limit: PAGE_SIZE }),
            ),
          { message: "טוען עמוד…", mode: "bar" },
        );
        setPayload(next);
        setPage(next.page);
      } finally {
        setTableLoading(false);
      }
    },
    [reportFilters, modalOpts, runWithLoading],
  );

  const kpis = payload?.kpis;

  return (
    <div className="adm-oor-erp" dir="rtl">
      <header className="adm-oor-erp-topbar">
        <h2 className="adm-oor-erp-topbar__title">{title}</h2>
        <div className="adm-oor-erp-topbar__actions">
          <LoadingButton
            type="button"
            className="adm-oor-erp-export-btn"
            loading={!!exportingExcel}
            loadingLabel="מייצא…"
            disabled={isLoading}
            onClick={() => void onExportExcel()}
          >
            Excel
          </LoadingButton>
          <LoadingButton
            type="button"
            className="adm-oor-erp-export-btn"
            loading={!!exportingPdf}
            loadingLabel="מכין…"
            disabled={isLoading}
            onClick={() => void onExportPdf()}
          >
            PDF
          </LoadingButton>
          <button type="button" className="adm-oor-erp-close" onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
      </header>

      <section className="adm-oor-erp-kpis" role="region" aria-label="מדדים">
        <div className="adm-oor-erp-kpi">
          <span className="adm-oor-erp-kpi__label">סה״כ הזמנות פתוחות</span>
          <strong className="adm-oor-erp-kpi__value">{bootLoading ? "—" : (kpis?.totalOrders ?? 0)}</strong>
        </div>
        <div className="adm-oor-erp-kpi">
          <span className="adm-oor-erp-kpi__label">סה״כ יתרה ₪</span>
          <strong className="adm-oor-erp-kpi__value">{bootLoading ? "—" : (kpis?.sumIls ?? "—")}</strong>
        </div>
        <div className="adm-oor-erp-kpi">
          <span className="adm-oor-erp-kpi__label">סה״כ יתרה $</span>
          <strong className="adm-oor-erp-kpi__value">{bootLoading ? "—" : (kpis?.sumUsd ?? "—")}</strong>
        </div>
        <div className="adm-oor-erp-kpi">
          <span className="adm-oor-erp-kpi__label">הזמנות בטיפול</span>
          <strong className="adm-oor-erp-kpi__value">{bootLoading ? "—" : (kpis?.inCareCount ?? 0)}</strong>
        </div>
      </section>

      <section className="adm-oor-erp-filters" aria-label="סינון">
        <div className="adm-oor-erp-filters__row">
          <label className="adm-oor-erp-field adm-oor-erp-field--search">
            <span className="adm-oor-erp-field__label">חיפוש חכם</span>
            <input
              className="adm-oor-erp-input"
              type="search"
              placeholder="חיפוש לקוח / קוד / הזמנה..."
              disabled={isLoading}
              value={smartDraft}
              onChange={(e) => setSmartDraft(e.target.value)}
            />
          </label>
          <label className="adm-oor-erp-field adm-oor-erp-field--status">
            <span className="adm-oor-erp-field__label">סטטוס הזמנה</span>
            <select
              className="adm-oor-erp-input"
              disabled={isLoading}
              value={statusBucket}
              onChange={(e) => setStatusBucket(e.target.value as OpenOrdersModalStatusBucket)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="adm-oor-erp-field adm-oor-erp-field--ah" aria-label="שבוע AH">
            <span className="adm-oor-erp-field__label">שבוע AH</span>
            <div className="adm-oor-erp-ah-card" dir="ltr">
              <button
                type="button"
                className="adm-oor-erp-ah-arrow"
                aria-label="שבוע קודם"
                disabled={isLoading}
                onClick={() => setModalWeekCode(shiftWeekCode(effectiveWeek, -1))}
              >
                &lt;
              </button>
              <select
                className="adm-oor-erp-ah-chip"
                aria-label="בחירת שבוע"
                disabled={isLoading}
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
                className="adm-oor-erp-ah-arrow"
                aria-label="שבוע הבא"
                disabled={isLoading}
                onClick={() => setModalWeekCode(shiftWeekCode(effectiveWeek, 1))}
              >
                &gt;
              </button>
            </div>
            {weekRangeLabel ? <span className="adm-oor-erp-ah-hint">{weekRangeLabel}</span> : null}
          </div>
          <label className="adm-oor-erp-field adm-oor-erp-field--date">
            <span className="adm-oor-erp-field__label">מתאריך</span>
            <input
              className="adm-oor-erp-input"
              type="date"
              disabled={isLoading}
              value={modalFromYmd}
              onChange={(e) => setModalFromYmd(e.target.value)}
            />
          </label>
          <label className="adm-oor-erp-field adm-oor-erp-field--date">
            <span className="adm-oor-erp-field__label">עד תאריך</span>
            <input
              className="adm-oor-erp-input"
              type="date"
              disabled={isLoading}
              value={modalToYmd}
              onChange={(e) => setModalToYmd(e.target.value)}
            />
          </label>
          <label className="adm-oor-erp-field adm-oor-erp-field--usd">
            <span className="adm-oor-erp-field__label">מינ׳ יתרה $</span>
            <input
              className="adm-oor-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading}
              value={minUsd}
              onChange={(e) => setMinUsd(e.target.value)}
            />
          </label>
          <label className="adm-oor-erp-field adm-oor-erp-field--usd">
            <span className="adm-oor-erp-field__label">מקס׳ יתרה $</span>
            <input
              className="adm-oor-erp-input"
              type="text"
              inputMode="decimal"
              disabled={isLoading}
              value={maxUsd}
              onChange={(e) => setMaxUsd(e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="adm-oor-erp-scroll">
        <div className={`adm-oor-erp-table-wrap${tableLoading ? " adm-oor-erp-table-wrap--busy" : ""}`}>
          <table className="adm-oor-erp-table">
            <thead>
              <tr>
                <th>מספר הזמנה</th>
                <th>לקוח</th>
                <th>שבוע</th>
                <th>סכום דולר</th>
                <th>סכום ₪</th>
                <th>סטטוס</th>
                <th>תשלום</th>
                <th>תאריך</th>
              </tr>
            </thead>
            {bootLoading && !payload ? (
              <tbody>
                <TableSkeleton rows={10} columns={8} />
              </tbody>
            ) : (
              <OpenOrdersErpTableBody rows={payload?.rows ?? []} busy={tableLoading} />
            )}
          </table>
        </div>
      </div>

      {payload && !bootLoading ? (
        <footer className="adm-oor-erp-footer">
          <div className="adm-oor-erp-footer__sums">
            <div className="adm-oor-erp-footer__cell adm-oor-erp-footer__cell--right">
              <span className="adm-oor-erp-footer__k">סה״כ הזמנות</span>
              <strong className="adm-oor-erp-footer__v">{payload.totalRows}</strong>
            </div>
            <div className="adm-oor-erp-footer__cell adm-oor-erp-footer__cell--center">
              <span className="adm-oor-erp-footer__k">סה״כ ₪</span>
              <strong className="adm-oor-erp-footer__v">{payload.kpis.sumIls}</strong>
            </div>
            <div className="adm-oor-erp-footer__cell adm-oor-erp-footer__cell--left">
              <span className="adm-oor-erp-footer__k">סה״כ $</span>
              <strong className="adm-oor-erp-footer__v">{payload.kpis.sumUsd}</strong>
            </div>
          </div>
          <div className="adm-oor-erp-footer__page">
            <button
              type="button"
              className="adm-oor-erp-page-mini"
              disabled={isLoading || tableLoading || page <= 1}
              aria-label="עמוד קודם"
              onClick={() => void goPage(page - 1)}
            >
              &lt;
            </button>
            <span className="adm-oor-erp-page-mini-num">{page}</span>
            <button
              type="button"
              className="adm-oor-erp-page-mini"
              disabled={isLoading || tableLoading || page >= payload.totalPages}
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
