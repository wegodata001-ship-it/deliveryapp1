"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportEmployeesSourceAction,
  getEmployeeSourcePreviewAction,
  listEmployeesSourceTableAction,
  resetEmployeePasswordAction,
  toggleEmployeeActiveAction,
  type EmployeesSourceListPayload,
} from "@/app/admin/source-tables/employees-actions";
import type { EmployeeRoleTone, EmployeesSourcePreview, EmployeesSourceRow } from "@/lib/employees-source-table";
import { Modal } from "@/components/ui/Modal";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import { CheckCircle2, Clock, FileSpreadsheet, FileText, Search, ShieldCheck, Users } from "lucide-react";

const PAGE_LIMIT = 25;
const FILTER_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;

type AdvancedFilters = {
  name: string;
  phone: string;
  role: "" | "ADMIN" | "EMPLOYEE";
  isActive: "" | "true" | "false";
  lastLoginFromYmd: string;
  lastLoginToYmd: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  name: "",
  phone: "",
  role: "",
  isActive: "",
  lastLoginFromYmd: "",
  lastLoginToYmd: "",
};

function roleBadgeClass(tone: EmployeeRoleTone): string {
  return `adm-employees-role-badge adm-employees-role-badge--${tone}`;
}

function downloadBase64(base64: string, filename: string, mime: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openPdfHtml(base64: string) {
  const bin = atob(base64);
  const html = new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

export function EmployeesSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [payload, setPayload] = useState<EmployeesSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<EmployeesSourceRow | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmployeesSourcePreview | null>(null);
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
    (p: number) => ({
      page: p,
      limit: PAGE_LIMIT,
      search: debouncedSearch,
      sortKey,
      sortDir,
      filters: {
        search: debouncedSearch || undefined,
        name: filters.name || undefined,
        phone: filters.phone || undefined,
        role: filters.role || undefined,
        isActive: filters.isActive || undefined,
        lastLoginFromYmd: filters.lastLoginFromYmd || undefined,
        lastLoginToYmd: filters.lastLoginToYmd || undefined,
      },
    }),
    [debouncedSearch, sortKey, sortDir, filters],
  );

  const runFetch = useCallback(() => {
    const seq = ++fetchGen.current;
    setLoading(true);
    setLoadError(null);
    void listEmployeesSourceTableAction(buildQuery(page))
      .then((next) => {
        if (fetchGen.current !== seq) return;
        setPayload(next);
        if (page > 1 && next.rows.length === 0) setPage(1);
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת עובדים");
      })
      .finally(() => {
        if (fetchGen.current !== seq) return;
        setLoading(false);
      });
  }, [page, buildQuery]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters, sortKey, sortDir]);

  const schedulePreview = useCallback((userId: string | null) => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!userId) {
      hoverIdRef.current = null;
      setHoverId(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = userId;
    setHoverId(userId);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getEmployeeSourcePreviewAction(userId)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== userId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportEmployeesSourceAction(buildQuery(1), kind);
    setExportBusy(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    if (kind === "pdf" && res.mime.startsWith("text/html")) {
      openPdfHtml(res.base64);
    } else {
      downloadBase64(res.base64, res.filename, res.mime);
    }
  }

  async function onToggleActive(row: EmployeesSourceRow) {
    const label = row.isActive ? "להשבית" : "להפעיל";
    if (!window.confirm(`${label} את ${row.fullName}?`)) return;
    setActionBusyId(row.id);
    const res = await toggleEmployeeActiveAction(row.id);
    setActionBusyId(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    runFetch();
  }

  async function onResetPassword(row: EmployeesSourceRow) {
    if (!window.confirm(`לאפס סיסמה ל־${row.fullName}?`)) return;
    setActionBusyId(row.id);
    const res = await resetEmployeePasswordAction(row.id);
    setActionBusyId(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    window.prompt(`סיסמה זמנית ל־${row.fullName} (העתק ומסור לעובד):`, res.password);
  }

  const kpis = payload?.kpis;
  const rows = payload?.rows ?? [];
  const hasMore = payload?.hasMore ?? false;

  return (
    <div className="adm-source-pro adm-employees-source">
      {kpis ? (
        <div className="adm-employees-source-kpi-row" dir="rtl">
          <div className="adm-employees-source-kpi-card">
            <span className="adm-employees-source-kpi-lbl"><Users size={16} strokeWidth={1.75} aria-hidden /> סה״כ עובדים</span>
            <strong>{kpis.totalEmployees.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-employees-source-kpi-card">
            <span className="adm-employees-source-kpi-lbl"><ShieldCheck size={16} strokeWidth={1.75} aria-hidden /> מנהלים</span>
            <strong>{kpis.managersCount.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-employees-source-kpi-card">
            <span className="adm-employees-source-kpi-lbl"><CheckCircle2 size={16} strokeWidth={1.75} aria-hidden /> עובדים פעילים</span>
            <strong>{kpis.activeCount.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-employees-source-kpi-card">
            <span className="adm-employees-source-kpi-lbl"><Clock size={16} strokeWidth={1.75} aria-hidden /> התחברו השבוע ({kpis.weekCode})</span>
            <strong>{kpis.loggedInWeekCount.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש מהיר: שם, משתמש, אימייל…"
          disabled={loading && !payload}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          {filterOpen ? "הסתר סינון" : <><Search size={16} strokeWidth={1.75} aria-hidden /> סינון</>}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("pdf")}
        >
          {exportBusy === "pdf" ? "…" : <><FileText size={16} strokeWidth={1.75} aria-hidden /> PDF</>}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("excel")}
        >
          {exportBusy === "excel" ? "…" : <><FileSpreadsheet size={16} strokeWidth={1.75} aria-hidden /> Excel</>}
        </button>
        <Link href="/admin/users/new" className="adm-btn adm-btn--primary adm-btn--xs">
          עובד חדש
        </Link>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => runFetch()} disabled={loading}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters adm-employees-source-advanced-filters" dir="rtl">
          <label>
            שם
            <input value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label>
            טלפון / משתמש
            <input
              value={filters.phone}
              onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))}
              dir="ltr"
              placeholder="משתמש או אימייל"
            />
          </label>
          <label>
            תפקיד
            <select value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value as AdvancedFilters["role"] }))}>
              <option value="">הכל</option>
              <option value="ADMIN">מנהל</option>
              <option value="EMPLOYEE">עובד</option>
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
          <label>
            כניסה מ-
            <input
              type="date"
              value={filters.lastLoginFromYmd}
              onChange={(e) => setFilters((f) => ({ ...f, lastLoginFromYmd: e.target.value }))}
            />
          </label>
          <label>
            עד
            <input
              type="date"
              value={filters.lastLoginToYmd}
              onChange={(e) => setFilters((f) => ({ ...f, lastLoginToYmd: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            נקה
          </button>
        </div>
      ) : null}

      {loadError ? <TableError message={loadError} onRetry={() => runFetch()} /> : null}

      <div className={["adm-employees-source-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        <table className="adm-table adm-employees-source-table">
          <thead>
            <tr>
              {[
                { key: "name", label: "שם" },
                { key: "role", label: "תפקיד" },
                { key: "phone", label: "קשר" },
                { key: "active", label: "פעיל" },
                { key: "lastLogin", label: "כניסה אחרונה" },
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
            <TableSkeleton columnCount={6} rowCount={10} />
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
                    className="adm-employees-source-row"
                    onMouseEnter={() => schedulePreview(r.id)}
                    onMouseLeave={() => schedulePreview(null)}
                  >
                    <td className="adm-employees-td-name">
                      <button type="button" className="adm-source-primary-link" onClick={() => setViewRow(r)}>
                        {r.fullName}
                      </button>
                    </td>
                    <td>
                      <span className={roleBadgeClass(r.roleTone)} title={r.roleLabel}>
                        {r.roleLabel}
                      </span>
                    </td>
                    <td className="adm-employees-td-contact" dir="ltr">
                      {r.phone}
                    </td>
                    <td>
                      <span className={r.isActive ? "adm-employees-active-yes" : "adm-employees-active-no"}>
                        {r.isActive ? "פעיל" : "לא פעיל"}
                      </span>
                    </td>
                    <td dir="ltr">{r.lastLoginYmd}</td>
                    <td className="adm-employees-td-actions">
                      <div className="adm-employees-actions">
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title="צפייה"
                          disabled={actionBusyId === r.id}
                          onClick={() => setViewRow(r)}
                        >
                          צפייה
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title="עריכה"
                          disabled={actionBusyId === r.id}
                          onClick={() => router.push(`/admin/users/${r.id}/edit`)}
                        >
                          עריכה
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title={r.isActive ? "השבתה" : "הפעלה"}
                          disabled={actionBusyId === r.id}
                          onClick={() => void onToggleActive(r)}
                        >
                          {r.isActive ? "השבתה" : "הפעלה"}
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          title="איפוס סיסמה"
                          disabled={actionBusyId === r.id}
                          onClick={() => void onResetPassword(r)}
                        >
                          איפוס סיסמה
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
        <div className="adm-employees-preview-popover" role="tooltip" dir="rtl">
          {previewBusy && !preview ? (
            <p className="adm-employees-preview-meta">טוען…</p>
          ) : preview ? (
            <>
              <p>
                <strong>{preview.fullName}</strong>
              </p>
              <p>
                <span>קשר</span> <span dir="ltr">{preview.phone}</span>
              </p>
              <p>
                <span>תפקיד</span> {preview.roleLabel}
              </p>
              <p>
                <span>כניסה אחרונה</span> <span dir="ltr">{preview.lastLoginYmd}</span>
              </p>
              <p>
                <span>סטטוס</span> {preview.isActive ? "פעיל" : "לא פעיל"}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {payload ? (
        <div className="adm-source-pro-pagination">
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            הקודם
          </button>
          <span>
            עמוד {page}
            {hasMore ? "+" : ""}
          </span>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            הבא
          </button>
        </div>
      ) : null}

      {viewRow ? (
        <Modal open onClose={() => setViewRow(null)} title={`עובד · ${viewRow.fullName}`}>
          <div className="adm-employees-view-modal" dir="rtl">
            <p>
              <span>שם</span> {viewRow.fullName}
            </p>
            <p>
              <span>משתמש</span> <span dir="ltr">{viewRow.username}</span>
            </p>
            <p>
              <span>אימייל</span> <span dir="ltr">{viewRow.email}</span>
            </p>
            <p>
              <span>תפקיד</span> <span className={roleBadgeClass(viewRow.roleTone)}>{viewRow.roleLabel}</span>
            </p>
            <p>
              <span>סטטוס</span> {viewRow.isActive ? "פעיל" : "לא פעיל"}
            </p>
            <p>
              <span>כניסה אחרונה</span> <span dir="ltr">{viewRow.lastLoginYmd}</span>
            </p>
            <div className="adm-employees-view-modal__actions">
              <button type="button" className="adm-btn adm-btn--primary" onClick={() => router.push(`/admin/users/${viewRow.id}/edit`)}>
                עריכה
              </button>
              <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setViewRow(null)}>
                סגור
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
