"use client";

import { PaymentMethod } from "@prisma/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportPaymentMethodsSourceAction,
  getPaymentMethodSourcePreviewAction,
  listPaymentMethodsSourceTableAction,
  togglePaymentMethodActiveAction,
  updatePaymentMethodSourceAction,
  type PaymentMethodsSourceListPayload,
} from "@/app/admin/source-tables/payment-methods-actions";
import type {
  PaymentMethodsSourcePreview,
  PaymentMethodsSourceRow,
  PaymentMethodTypeTone,
} from "@/lib/payment-methods-source-table";
import { Modal } from "@/components/ui/Modal";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import {
  CheckCircle2,
  CreditCard,
  Eye,
  FileSpreadsheet,
  FileText,
  Landmark,
  Lock,
  Pencil,
  Search,
  XCircle,
} from "lucide-react";

const FILTER_DEBOUNCE_MS = 300;
const PREVIEW_DEBOUNCE_MS = 260;

type AdvancedFilters = {
  name: string;
  type: "" | "bank" | keyof typeof PaymentMethod;
  isActive: "" | "true" | "false";
};

const EMPTY_FILTERS: AdvancedFilters = { name: "", type: "", isActive: "" };

const TYPE_FILTER_OPTIONS = [
  { value: "", label: "הכל" },
  { value: "CASH", label: "מזומן" },
  { value: "bank", label: "העברה בנקאית" },
  { value: "CREDIT", label: "אשראי" },
  { value: "CHECK", label: "צ׳ק" },
  { value: "POINT", label: "נקודת תשלום" },
];

function typeBadgeClass(tone: PaymentMethodTypeTone): string {
  return `adm-pm-method-type-badge adm-pm-method-type-badge--${tone}`;
}

import { downloadBase64File, handleSourceTableExportResult } from "@/lib/pdf-export-client";

export function PaymentMethodsSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(true);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [payload, setPayload] = useState<PaymentMethodsSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<PaymentMethodsSourceRow | null>(null);
  const [editRow, setEditRow] = useState<PaymentMethodsSourceRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaymentMethodsSourcePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const fetchGen = useRef(0);
  const previewGen = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(
    () => ({
      search: debouncedSearch,
      sortKey,
      sortDir,
      filters: {
        search: debouncedSearch || undefined,
        name: filters.name || undefined,
        type: filters.type || undefined,
        isActive: filters.isActive || undefined,
      },
    }),
    [debouncedSearch, sortKey, sortDir, filters],
  );

  const runFetch = useCallback(() => {
    const seq = ++fetchGen.current;
    setLoading(true);
    setLoadError(null);
    void listPaymentMethodsSourceTableAction(buildQuery())
      .then((next) => {
        if (fetchGen.current !== seq) return;
        setPayload(next);
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת אמצעי תשלום");
      })
      .finally(() => {
        if (fetchGen.current !== seq) return;
        setLoading(false);
      });
  }, [buildQuery]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const schedulePreview = useCallback((methodId: string | null) => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!methodId) {
      hoverIdRef.current = null;
      setHoverId(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = methodId;
    setHoverId(methodId);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getPaymentMethodSourcePreviewAction(methodId)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== methodId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportPaymentMethodsSourceAction(buildQuery(), kind);
    setExportBusy(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    handleSourceTableExportResult(kind, res, setLoadError, downloadBase64File);
  }

  function openEdit(row: PaymentMethodsSourceRow) {
    setEditRow(row);
    setEditName(row.nameHe);
    setEditActive(row.isActive);
  }

  async function saveEdit() {
    if (!editRow) return;
    setActionBusyId(editRow.id);
    const res = await updatePaymentMethodSourceAction(editRow.id, editName, editActive);
    setActionBusyId(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setEditRow(null);
    runFetch();
  }

  async function onToggle(row: PaymentMethodsSourceRow) {
    const label = row.isActive ? "להשבית" : "להפעיל";
    if (!window.confirm(`${label} את ${row.nameHe}?`)) return;
    setActionBusyId(row.id);
    const res = await togglePaymentMethodActiveAction(row.id);
    setActionBusyId(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    runFetch();
  }

  const kpis = payload?.kpis;
  const rows = payload?.rows ?? [];

  return (
    <div className="adm-source-pro adm-pm-source">
      {kpis ? (
        <div className="adm-pm-source-kpi-row" dir="rtl">
          <div className="adm-pm-source-kpi-card">
            <span className="adm-pm-source-kpi-lbl"><CreditCard size={16} strokeWidth={1.75} aria-hidden /> סה״כ אמצעי תשלום</span>
            <strong>{kpis.totalMethods.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-pm-source-kpi-card">
            <span className="adm-pm-source-kpi-lbl"><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /> פעילים</span>
            <strong>{kpis.activeCount.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-pm-source-kpi-card">
            <span className="adm-pm-source-kpi-lbl"><XCircle size={16} strokeWidth={1.75} aria-hidden /> לא פעילים</span>
            <strong>{kpis.inactiveCount.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-pm-source-kpi-card">
            <span className="adm-pm-source-kpi-lbl"><Landmark size={16} strokeWidth={1.75} aria-hidden /> העברות בנקאיות</span>
            <strong>{kpis.bankTransferPayments.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש שם או סוג…"
          disabled={loading && !payload}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          {filterOpen ? "הסתר סינון" : <><Search size={16} strokeWidth={1.75} aria-hidden /> סינון</>}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" disabled={!!exportBusy || loading} onClick={() => void runExport("pdf")}>
          {exportBusy === "pdf" ? "…" : <><FileText size={16} strokeWidth={1.75} aria-hidden /> PDF</>}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" disabled={!!exportBusy || loading} onClick={() => void runExport("excel")}>
          {exportBusy === "excel" ? "…" : <><FileSpreadsheet size={16} strokeWidth={1.75} aria-hidden /> Excel</>}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => runFetch()} disabled={loading}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters adm-pm-source-advanced-filters" dir="rtl">
          <label>
            שם
            <input value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label>
            סוג
            <select
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as AdvancedFilters["type"] }))}
            >
              {TYPE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            פעיל
            <select
              value={filters.isActive}
              onChange={(e) => setFilters((f) => ({ ...f, isActive: e.target.value as AdvancedFilters["isActive"] }))}
            >
              <option value="">הכל</option>
              <option value="true">פעיל</option>
              <option value="false">לא פעיל</option>
            </select>
          </label>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => setFilters(EMPTY_FILTERS)}>
            נקה
          </button>
        </div>
      ) : null}

      {loadError ? <TableError message={loadError} onRetry={() => runFetch()} /> : null}

      <div className={["adm-pm-source-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        <table className="adm-table adm-pm-source-table">
          <thead>
            <tr>
              {[
                { key: "name", label: "שם" },
                { key: "type", label: "סוג" },
                { key: "active", label: "פעיל" },
                { key: "usage", label: "שימושים" },
                { key: "created", label: "נוצר" },
                { key: "actions", label: "פעולות", sortable: false },
              ].map((col) => (
                <th key={col.key}>
                  {col.sortable === false ? (
                    col.label
                  ) : (
                    <button
                      type="button"
                      className="adm-source-sort-btn"
                      disabled={loading}
                      onClick={() => {
                        setSortKey(col.key);
                        setSortDir((d) => (sortKey === col.key && d === "asc" ? "desc" : "asc"));
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {loading && !payload ? (
            <TableSkeleton columnCount={6} rowCount={8} />
          ) : (
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <TableEmpty />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="adm-pm-source-row"
                    onMouseEnter={() => schedulePreview(r.id)}
                    onMouseLeave={() => schedulePreview(null)}
                  >
                    <td className="adm-pm-td-name">{r.nameHe}</td>
                    <td>
                      <span className={typeBadgeClass(r.typeTone)}>{r.typeLabel}</span>
                    </td>
                    <td>
                      <span className={r.isActive ? "adm-pm-active-yes" : "adm-pm-active-no"}>
                        {r.isActive ? "פעיל" : "לא פעיל"}
                      </span>
                    </td>
                    <td>
                      <strong className="adm-pm-usage-count">{r.usageCount.toLocaleString("he-IL")}</strong>
                    </td>
                    <td dir="ltr">{r.createdAtYmd}</td>
                    <td>
                      <div className="adm-pm-actions">
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title="צפייה"
                          disabled={actionBusyId === r.id}
                          onClick={() => setViewRow(r)}
                        >
                          <Eye size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title="עריכה"
                          disabled={actionBusyId === r.id}
                          onClick={() => openEdit(r)}
                        >
                          <Pencil size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title={r.isActive ? "השבתה" : "הפעלה"}
                          disabled={actionBusyId === r.id}
                          onClick={() => void onToggle(r)}
                        >
                          <Lock size={16} strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          )}
        </table>
      </div>

      {hoverId && (preview || previewBusy) ? (
        <div className="adm-pm-preview-popover" role="tooltip" dir="rtl">
          {previewBusy && !preview ? (
            <p className="adm-pm-preview-meta">טוען…</p>
          ) : preview ? (
            <>
              <p>
                <strong>{preview.name}</strong>
              </p>
              <p>
                <span>סוג</span> {preview.typeLabel}
              </p>
              <p>
                <span>סטטוס</span> {preview.statusLabel}
              </p>
              <p>
                <span>שימושים</span> {preview.usageCount.toLocaleString("he-IL")}
              </p>
              <p>
                <span>נוצר</span> <span dir="ltr">{preview.createdAtYmd}</span>
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {viewRow ? (
        <Modal open onClose={() => setViewRow(null)} title={`אמצעי תשלום · ${viewRow.nameHe}`}>
          <div className="adm-pm-view-modal" dir="rtl">
            <p>
              <span>קוד</span> <span dir="ltr">{viewRow.id}</span>
            </p>
            <p>
              <span>סוג</span> <span className={typeBadgeClass(viewRow.typeTone)}>{viewRow.typeLabel}</span>
            </p>
            <p>
              <span>סטטוס</span> {viewRow.isActive ? "פעיל" : "לא פעיל"}
            </p>
            <p>
              <span>שימושים</span> {viewRow.usageCount.toLocaleString("he-IL")}
            </p>
            <p>
              <span>נוצר</span> <span dir="ltr">{viewRow.createdAtYmd}</span>
            </p>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setViewRow(null)}>
              סגור
            </button>
          </div>
        </Modal>
      ) : null}

      {editRow ? (
        <Modal open onClose={() => setEditRow(null)} title={`עריכה · ${editRow.nameHe}`}>
          <div className="adm-pm-edit-modal" dir="rtl">
            <label>
              שם תצוגה
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label className="adm-pm-edit-active">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              פעיל במערכת
            </label>
            <div className="adm-pm-edit-modal__actions">
              <button type="button" className="adm-btn adm-btn--primary" disabled={actionBusyId === editRow.id} onClick={() => void saveEdit()}>
                שמירה
              </button>
              <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setEditRow(null)}>
                ביטול
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
