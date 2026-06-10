"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listPaymentsByLocationReportModalAction,
  type PaymentsByLocationModalPayload,
  type PaymentsByLocationModalQuery,
  type PaymentsByLocationModalRow,
} from "@/app/admin/reports/payments-by-location-modal-actions";
import type { ReportFilters } from "@/app/admin/reports/actions";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { LoadingButton, TableSkeleton } from "@/components/ui/loading";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import { MapPin } from "lucide-react";

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

export type PaymentsByLocationReportModalProps = {
  reportFilters: ReportFilters;
  title: string;
  onClose: () => void;
  onExportPdf: () => void | Promise<void>;
  onExportExcel: () => void | Promise<void>;
  exportingPdf?: boolean;
  exportingExcel?: boolean;
};

function toModalQuery(page: number, opts: Omit<PaymentsByLocationModalQuery, "page">): PaymentsByLocationModalQuery {
  return { page, ...opts };
}

type TableBodyProps = {
  rows: PaymentsByLocationModalRow[];
  busy: boolean;
};

const PblTableBody = memo(function PblTableBody({ rows, busy }: TableBodyProps) {
  if (busy) {
    return (
      <tbody>
        <TableSkeleton rows={10} columns={5} />
      </tbody>
    );
  }
  if (rows.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={5} className="adm-pbl-erp-empty-cell">
            <div className="adm-pbl-erp-empty">
              <span className="adm-pbl-erp-empty__icon" aria-hidden>
                <MapPin size={18} strokeWidth={1.75} />
              </span>
              <p className="adm-pbl-erp-empty__text">לא נמצאו תשלומים לפי הסינון שנבחר</p>
            </div>
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.place} className="adm-pbl-erp-data-row">
          <td className="adm-pbl-erp-place">{row.place}</td>
          <td className="adm-pbl-erp-num">{row.count.toLocaleString("he-IL")}</td>
          <td className="adm-pbl-erp-num adm-pbl-erp-num--strong">{row.sumIls}</td>
          <td className="adm-pbl-erp-num">{row.sumUsd}</td>
          <td className="adm-pbl-erp-num">{row.avgIls}</td>
        </tr>
      ))}
    </tbody>
  );
});

export function PaymentsByLocationReportModal({
  reportFilters,
  title,
  onClose,
  onExportPdf,
  onExportExcel,
  exportingPdf,
  exportingExcel,
}: PaymentsByLocationReportModalProps) {
  const { runWithLoading, isLoading } = useAdminLoading();
  const [payload, setPayload] = useState<PaymentsByLocationModalPayload | null>(null);
  const [page, setPage] = useState(1);
  const [modalWeekCode, setModalWeekCode] = useState("");
  const [modalFromYmd, setModalFromYmd] = useState("");
  const [modalToYmd, setModalToYmd] = useState("");
  const [minIls, setMinIls] = useState("");
  const [maxIls, setMaxIls] = useState("");
  const [smartDraft, setSmartDraft] = useState("");
  const [smartDebounced, setSmartDebounced] = useState("");
  const [bootLoading, setBootLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const seenFirst = useRef(false);

  const reportKey = useMemo(() => JSON.stringify(reportFilters), [reportFilters]);

  const selectedWeek = useMemo(() => normalizeAhWeekCode(modalWeekCode.trim() || undefined), [modalWeekCode]);

  const navBaseWeek = useMemo(
    () => selectedWeek ?? normalizeAhWeekCode(reportFilters.workWeek) ?? DEFAULT_WEEK_CODE,
    [selectedWeek, reportFilters.workWeek],
  );

  const weekOptions = useMemo(() => {
    const set = new Set<string>(WORK_WEEK_CODES_SORTED);
    set.add(navBaseWeek);
    const maxN = [...set].reduce((m, c) => Math.max(m, weekNumber(c)), 0);
    for (let i = Math.max(1, maxN - 8); i <= maxN + 16; i++) set.add(`AH-${i}`);
    return [...set].sort((a, b) => weekNumber(a) - weekNumber(b));
  }, [navBaseWeek]);

  const weekRangeLabel = useMemo(() => {
    if (!selectedWeek) return "";
    const r = getAhWeekRange(selectedWeek);
    if (!r) return "";
    const fmt = (ymd: string) => {
      const [y, mo, d] = ymd.split("-");
      return `${d}/${mo}/${y}`;
    };
    return `${fmt(r.from)} - ${fmt(r.to)}`;
  }, [selectedWeek]);

  useEffect(() => {
    setModalWeekCode("");
    setModalFromYmd(reportFilters.dateFrom ?? "");
    setModalToYmd(reportFilters.dateTo ?? "");
    setPage(1);
  }, [reportKey]);

  const modalOpts = useMemo(
    () => ({
      smart: smartDebounced,
      weekCode: modalWeekCode.trim() || undefined,
      fromYmd: modalFromYmd.trim() || undefined,
      toYmd: modalToYmd.trim() || undefined,
      minIls: minIls.trim() || undefined,
      maxIls: maxIls.trim() || undefined,
    }),
    [smartDebounced, modalWeekCode, modalFromYmd, modalToYmd, minIls, maxIls],
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
            listPaymentsByLocationReportModalAction(
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
            listPaymentsByLocationReportModalAction(
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
    <div className="adm-pbl-erp" dir="rtl">
      <header className="adm-pbl-erp-topbar">
        <h2 className="adm-pbl-erp-topbar__title">{title}</h2>
        <div className="adm-pbl-erp-topbar__actions">
          <LoadingButton
            type="button"
            className="adm-pbl-erp-export-btn"
            loading={!!exportingPdf}
            loadingLabel="מכין…"
            disabled={isLoading}
            onClick={() => void onExportPdf()}
          >
            PDF
          </LoadingButton>
          <LoadingButton
            type="button"
            className="adm-pbl-erp-export-btn"
            loading={!!exportingExcel}
            loadingLabel="מייצא…"
            disabled={isLoading}
            onClick={() => void onExportExcel()}
          >
            Excel
          </LoadingButton>
          <button type="button" className="adm-pbl-erp-close" onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
      </header>

      <section className="adm-pbl-erp-kpis" role="region" aria-label="מדדים">
        <div className="adm-pbl-erp-kpi">
          <span className="adm-pbl-erp-kpi__label">סה״כ תשלומים</span>
          <strong className="adm-pbl-erp-kpi__value">{bootLoading ? "—" : (kpis?.totalPayments ?? 0).toLocaleString("he-IL")}</strong>
        </div>
        <div className="adm-pbl-erp-kpi">
          <span className="adm-pbl-erp-kpi__label">סה״כ ₪</span>
          <strong className="adm-pbl-erp-kpi__value">{bootLoading ? "—" : (kpis?.sumIls ?? "—")}</strong>
        </div>
        <div className="adm-pbl-erp-kpi">
          <span className="adm-pbl-erp-kpi__label">מספר מקומות תשלום</span>
          <strong className="adm-pbl-erp-kpi__value">{bootLoading ? "—" : (kpis?.placeCount ?? 0).toLocaleString("he-IL")}</strong>
        </div>
      </section>

      <section className="adm-pbl-erp-filters" aria-label="סינון">
        <div className="adm-pbl-erp-filters__row">
          <label className="adm-pbl-erp-field adm-pbl-erp-field--search">
            <span className="adm-pbl-erp-field__label">חיפוש מקום תשלום</span>
            <input
              className="adm-pbl-erp-input"
              type="search"
              placeholder="חיפוש מקום תשלום..."
              disabled={isLoading}
              value={smartDraft}
              onChange={(e) => setSmartDraft(e.target.value)}
            />
          </label>
          <div className="adm-pbl-erp-field adm-pbl-erp-field--ah" aria-label="שבוע AH">
            <span className="adm-pbl-erp-field__label">שבוע AH</span>
            <div className="adm-pbl-erp-ah-card" dir="ltr">
              <button
                type="button"
                className="adm-pbl-erp-ah-arrow"
                aria-label="שבוע קודם"
                disabled={isLoading}
                onClick={() => setModalWeekCode(shiftWeekCode(navBaseWeek, -1))}
              >
                &lt;
              </button>
              <select
                className="adm-pbl-erp-ah-chip"
                aria-label="בחירת שבוע"
                disabled={isLoading}
                value={selectedWeek ?? ""}
                onChange={(e) => setModalWeekCode(e.target.value)}
              >
                <option value="">כל השבועות</option>
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="adm-pbl-erp-ah-arrow"
                aria-label="שבוע הבא"
                disabled={isLoading}
                onClick={() => setModalWeekCode(shiftWeekCode(navBaseWeek, 1))}
              >
                &gt;
              </button>
            </div>
            {weekRangeLabel ? <span className="adm-pbl-erp-ah-hint">{weekRangeLabel}</span> : null}
          </div>
          <label className="adm-pbl-erp-field adm-pbl-erp-field--date">
            <span className="adm-pbl-erp-field__label">מתאריך</span>
            <input
              className="adm-pbl-erp-input"
              type="date"
              disabled={isLoading}
              value={modalFromYmd}
              onChange={(e) => setModalFromYmd(e.target.value)}
            />
          </label>
          <label className="adm-pbl-erp-field adm-pbl-erp-field--date">
            <span className="adm-pbl-erp-field__label">עד תאריך</span>
            <input
              className="adm-pbl-erp-input"
              type="date"
              disabled={isLoading}
              value={modalToYmd}
              onChange={(e) => setModalToYmd(e.target.value)}
            />
          </label>
          <label className="adm-pbl-erp-field adm-pbl-erp-field--amt">
            <span className="adm-pbl-erp-field__label">מינימום סכום</span>
            <input
              className="adm-pbl-erp-input"
              type="text"
              inputMode="decimal"
              placeholder="₪"
              disabled={isLoading}
              value={minIls}
              onChange={(e) => setMinIls(e.target.value)}
            />
          </label>
          <label className="adm-pbl-erp-field adm-pbl-erp-field--amt">
            <span className="adm-pbl-erp-field__label">מקסימום סכום</span>
            <input
              className="adm-pbl-erp-input"
              type="text"
              inputMode="decimal"
              placeholder="₪"
              disabled={isLoading}
              value={maxIls}
              onChange={(e) => setMaxIls(e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="adm-pbl-erp-scroll">
        <div className={`adm-pbl-erp-table-wrap${tableLoading ? " adm-pbl-erp-table-wrap--busy" : ""}`}>
          <table className="adm-pbl-erp-table">
            <thead>
              <tr>
                <th>מקום תשלום</th>
                <th>כמות תשלומים</th>
                <th>סה״כ ₪</th>
                <th>סה״כ $</th>
                <th>ממוצע תשלום</th>
              </tr>
            </thead>
            {bootLoading && !payload ? (
              <tbody>
                <TableSkeleton rows={10} columns={5} />
              </tbody>
            ) : (
              <PblTableBody rows={payload?.rows ?? []} busy={tableLoading} />
            )}
          </table>
        </div>
      </div>

      {payload && !bootLoading ? (
        <footer className="adm-pbl-erp-footer">
          <div className="adm-pbl-erp-footer__sums">
            <div className="adm-pbl-erp-footer__cell adm-pbl-erp-footer__cell--right">
              <span className="adm-pbl-erp-footer__k">סה״כ ₪</span>
              <strong className="adm-pbl-erp-footer__v">{payload.footer.sumIls}</strong>
            </div>
            <div className="adm-pbl-erp-footer__cell adm-pbl-erp-footer__cell--center">
              <span className="adm-pbl-erp-footer__k">סה״כ $</span>
              <strong className="adm-pbl-erp-footer__v">{payload.footer.sumUsd}</strong>
            </div>
            <div className="adm-pbl-erp-footer__cell adm-pbl-erp-footer__cell--left">
              <span className="adm-pbl-erp-footer__k">סה״כ תשלומים</span>
              <strong className="adm-pbl-erp-footer__v">{payload.footer.totalPayments.toLocaleString("he-IL")}</strong>
            </div>
          </div>
          <div className="adm-pbl-erp-footer__page">
            <button
              type="button"
              className="adm-pbl-erp-page-mini"
              disabled={isLoading || tableLoading || page <= 1}
              aria-label="עמוד קודם"
              onClick={() => void goPage(page - 1)}
            >
              &lt;
            </button>
            <span className="adm-pbl-erp-page-mini-num">{page}</span>
            <button
              type="button"
              className="adm-pbl-erp-page-mini"
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
