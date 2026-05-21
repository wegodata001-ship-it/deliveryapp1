"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteSourceTableRowsAction,
  listSourceTableDataAction,
  upsertSourceTableRowAction,
  type SourceTableData,
  type SourceTableId,
  type SourceTableRow,
} from "@/app/admin/source-tables/actions";
import { Modal } from "@/components/ui/Modal";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 400;
const CACHE_TTL_MS = 45_000;

type Props = {
  tableId: SourceTableId;
  initialData?: SourceTableData | null;
  initialSearch?: string;
};

type ModalState = { type: "view"; row: SourceTableRow } | { type: "edit"; row: SourceTableRow } | { type: "payment"; row: SourceTableRow } | { type: "add" } | null;

function toneClass(tone: SourceTableRow["tone"]) {
  return `adm-source-pro-row--${tone || "neutral"}`;
}

export function SourceTableProClient({ tableId, initialData = null, initialSearch = "" }: Props) {
  const { openWindow } = useAdminWindows();
  const [data, setData] = useState<SourceTableData | null>(initialData);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!initialData);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fetchGen = useRef(0);
  const cacheRef = useRef(new Map<string, { ts: number; data: SourceTableData }>());

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setSearchInput(initialSearch);
    setDebouncedSearch(initialSearch);
    setPage(1);
  }, [initialSearch, tableId]);

  useEffect(() => {
    fetchGen.current += 1;
    setData(initialData ?? null);
    setPage(initialData?.page ?? 1);
    setSelected([]);
    setModal(null);
    setErr(null);
    setLoadError(null);
    setLoading(!initialData);
  }, [tableId, initialData]);

  const buildFetchKey = useCallback(
    (p: number) =>
      JSON.stringify({
        tableId,
        page: p,
        limit: PAGE_LIMIT,
        search: debouncedSearch,
        sortKey,
        sortDir,
        status,
        customer,
      }),
    [tableId, debouncedSearch, sortKey, sortDir, status, customer],
  );

  const runFetch = useCallback(() => {
    const seq = ++fetchGen.current;
    const key = buildFetchKey(page);
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setData(cached.data);
      setPage((p) => Math.min(p, cached.data.totalPages));
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    void listSourceTableDataAction(tableId, {
      page,
      limit: PAGE_LIMIT,
      search: debouncedSearch,
      sortKey,
      sortDir,
      filters: { status, customer },
    })
      .then((next) => {
        if (fetchGen.current !== seq) return;
        if (next) {
          cacheRef.current.set(key, { ts: Date.now(), data: next });
          setData(next);
          setPage((p) => Math.min(p, next.totalPages));
          if (next.page < next.totalPages) {
            const nextKey = buildFetchKey(next.page + 1);
            if (!cacheRef.current.has(nextKey)) {
              window.setTimeout(() => {
                void listSourceTableDataAction(tableId, {
                  page: next.page + 1,
                  limit: PAGE_LIMIT,
                  search: debouncedSearch,
                  sortKey,
                  sortDir,
                  filters: { status, customer },
                }).then((pref) => {
                  if (pref) cacheRef.current.set(nextKey, { ts: Date.now(), data: pref });
                });
              }, 0);
            }
          }
        } else {
          setLoadError("לא ניתן לטעון את הנתונים");
        }
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת הנתונים");
      })
      .finally(() => {
        if (fetchGen.current !== seq) return;
        setLoading(false);
      });
  }, [tableId, page, debouncedSearch, sortKey, sortDir, status, customer, buildFetchKey]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    if (!data) return;
    const t = window.setInterval(() => {
      if (modal) return;
      void listSourceTableDataAction(tableId, {
        page,
        limit: PAGE_LIMIT,
        search: debouncedSearch,
        sortKey,
        sortDir,
        filters: { status, customer },
      }).then((next) => {
        if (next) {
          cacheRef.current.set(buildFetchKey(page), { ts: Date.now(), data: next });
          setData(next);
        }
      });
    }, 45000);
    return () => window.clearInterval(t);
  }, [tableId, page, debouncedSearch, sortKey, sortDir, status, customer, data, modal]);

  const startModal = useCallback(
    (next: ModalState) => {
      if (next && loading) return;
      setModal(next);
      if (!next) {
        setForm({});
        return;
      }
      if (!data) return;
      if (next.type === "add") {
        setForm(Object.fromEntries(data.columns.filter((c) => c.editable).map((c) => [c.key, ""])));
        return;
      }
      setForm(next.row.cells);
    },
    [loading, data],
  );

  function toggleSelected(id: string) {
    setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  }

  const refresh = useCallback(() => {
    runFetch();
  }, [runFetch]);

  async function save(rowId?: string) {
    setErr(null);
    const res = await upsertSourceTableRowAction({ table: tableId, id: rowId, values: form });
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    startModal(null);
    cacheRef.current.clear();
    runFetch();
  }

  async function deleteRows(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm("למחוק את הרשומות המסומנות?")) return;
    const res = await deleteSourceTableRowsAction(tableId, ids);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setSelected([]);
    cacheRef.current.clear();
    runFetch();
  }

  function openLinked(row: SourceTableRow) {
    if (loading) return;
    if (tableId === "customers" || tableId === "customer-balances") {
      openWindow({ type: "customerCard", props: { customerId: row.id, customerName: row.cells.name || row.cells.customer, initialTab: "ledger" } });
      return;
    }
    startModal({ type: "view", row });
  }

  function openCustomer(row: SourceTableRow) {
    const customerId = row.meta?.customerId;
    if (!customerId) return;
    openWindow({ type: "customerCard", props: { customerId, customerName: row.cells.customer, initialTab: "ledger" } });
  }

  function openPayment(row: SourceTableRow) {
    startModal({ type: "payment", row });
  }

  async function changeOrderStatus(row: SourceTableRow, statusCode: string) {
    const values = { ...row.cells, status: statusCode };
    setData((old) =>
      old
        ? {
            ...old,
            rows: old.rows.map((r) => (r.id === row.id ? { ...r, cells: values } : r)),
          }
        : old,
    );
    const res = await upsertSourceTableRowAction({ table: tableId, id: row.id, values });
    if (!res.ok) setErr(res.error);
    else runFetch();
  }

  const colCount = data ? data.columns.length + 2 : 8;
  const editableColumns = data?.columns.filter((c) => c.editable) ?? [];

  return (
    <div className="adm-source-pro">
      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="חיפוש חכם: שם, קוד, טלפון, הזמנה, תשלום, צ׳יק, שבוע, הערות…"
          disabled={loading && !data}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)} disabled={!data}>
          סינון 🔍
        </button>
        {data?.canAdd ? (
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => startModal({ type: "add" })} disabled={loading}>
            + הוסף
          </button>
        ) : null}
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void refresh()} disabled={loading && !data}>
          רענון
        </button>
      </div>

      {data && filterOpen ? (
        <div className="adm-source-pro-filters">
          <label>
            סטטוס
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">הכל</option>
              {data.columns.find((c) => c.key === "status")?.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            לקוח
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="שם לקוח" />
          </label>
          <label>
            מתאריך
            <input type="date" />
          </label>
          <label>
            עד תאריך
            <input type="date" />
          </label>
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className="adm-source-bulk-bar">
          <strong>{selected.length} נבחרו</strong>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => void deleteRows(selected)} disabled={loading}>
            מחק
          </button>
        </div>
      ) : null}

      {err ? <div className="adm-error">{err}</div> : null}
      {loadError ? (
        <TableError message={loadError} onRetry={() => runFetch()} />
      ) : null}

      <div className={["adm-source-pro-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        {!data ? (
          <table className="adm-table adm-source-pro-table" aria-busy="true">
            <thead>
              <tr>
                {Array.from({ length: colCount }).map((_, i) => (
                  <th key={i}> </th>
                ))}
              </tr>
            </thead>
            <TableSkeleton columnCount={colCount} rowCount={7} />
          </table>
        ) : (
          <table className="adm-table adm-source-pro-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={data.rows.length > 0 && selected.length === data.rows.length}
                    onChange={(e) => setSelected(e.target.checked ? data.rows.map((r) => r.id) : [])}
                    disabled={loading}
                  />
                </th>
                {data.columns.map((col) => (
                  <th key={col.key}>
                    <button
                      type="button"
                      className="adm-source-sort-btn"
                      disabled={loading}
                      onClick={() => {
                        if (!col.sortable) return;
                        setSortKey(col.key);
                        setSortDir((d) => (sortKey === col.key && d === "asc" ? "desc" : "asc"));
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th>פעולות</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton columnCount={colCount} rowCount={7} />
            ) : (
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={data.columns.length + 2}>
                      <TableEmpty />
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id} className={`adm-source-pro-row ${toneClass(r.tone)}`} onDoubleClick={() => openLinked(r)}>
                      <td>
                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelected(r.id)} disabled={loading} />
                      </td>
                      {data.columns.map((c, idx) => (
                        <td key={c.key}>
                          {tableId === "orders" && c.key === "status" && c.options ? (
                            <select
                              className="adm-source-status-inline"
                              value={r.meta?.statusEnum || r.cells.status || ""}
                              onChange={(e) => void changeOrderStatus(r, e.target.value)}
                              aria-label="שינוי סטטוס הזמנה"
                              disabled={loading}
                            >
                              {c.options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : tableId === "orders" && c.key === "customer" ? (
                            <button
                              type="button"
                              className="adm-source-primary-link"
                              onClick={() => openCustomer(r)}
                              disabled={!r.meta?.customerId || loading}
                            >
                              {r.cells[c.key] || "—"}
                            </button>
                          ) : tableId === "orders" && c.key === "payment" ? (
                            <button
                              type="button"
                              className="adm-source-primary-link"
                              onClick={() => openPayment(r)}
                              disabled={!r.meta?.paymentId || loading}
                            >
                              {r.cells[c.key] || "אין תשלום"}
                            </button>
                          ) : tableId === "payments" && c.key === "checkBadge" ? (
                            r.cells.checkBadge && r.cells.checkBadge.trim() && r.cells.checkBadge !== "—" ? (
                              <span className="adm-source-check-badge">{r.cells.checkBadge}</span>
                            ) : (
                              <span>—</span>
                            )
                          ) : idx === 0 ? (
                            <button type="button" className="adm-source-primary-link" onClick={() => openLinked(r)} disabled={loading}>
                              {r.cells[c.key] || "—"}
                            </button>
                          ) : (
                            <span>{r.cells[c.key] || "—"}</span>
                          )}
                        </td>
                      ))}
                      <td>
                        <div className="adm-source-row-actions">
                          <button type="button" onClick={() => startModal({ type: "view", row: r })} disabled={loading}>
                            👁 צפייה
                          </button>
                          {editableColumns.length ? (
                            <button type="button" onClick={() => startModal({ type: "edit", row: r })} disabled={loading}>
                              ✏️ ערוך
                            </button>
                          ) : null}
                          <button type="button" onClick={() => void deleteRows([r.id])} disabled={loading}>
                            🗑 מחק
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            )}
            {data.summary && !loading ? (
              <tfoot>
                <tr>
                  <td colSpan={data.columns.length + 2}>
                    <div className="adm-source-summary-row">
                      {data.summary.total ? (
                        <span>
                          סה״כ: <strong>{data.summary.total}</strong>
                        </span>
                      ) : null}
                      {data.summary.paid ? (
                        <span>
                          שולם: <strong>{data.summary.paid}</strong>
                        </span>
                      ) : null}
                      {data.summary.remaining ? (
                        <span>
                          נשאר: <strong>{data.summary.remaining}</strong>
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
      </div>

      {data ? (
        <div className="adm-source-pro-pagination">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
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
            Next
          </button>
        </div>
      ) : null}

      <Modal
        open={!!modal}
        onClose={() => startModal(null)}
        title={modal?.type === "add" ? "הוספה" : modal?.type === "edit" ? "עריכה" : modal?.type === "payment" ? "אישור תשלום" : "צפייה"}
        size="lg"
      >
        {modal && data ? (
          <div className="adm-source-modal-form">
            {modal.type === "payment" ? (
              <>
                <label>
                  מספר תשלום
                  <strong>{modal.row.meta?.paymentCode || "—"}</strong>
                </label>
                <label>
                  איך שולם
                  <strong>{modal.row.meta?.paymentMethod || "—"}</strong>
                </label>
                <label>
                  סכום בשקלים
                  <strong>{modal.row.meta?.paymentAmountIls || "—"}</strong>
                </label>
                <label>
                  סכום בדולר
                  <strong>{modal.row.meta?.paymentAmountUsd || "—"}</strong>
                </label>
                <label>
                  תאריך תשלום
                  <strong>{modal.row.meta?.paymentDate || "—"}</strong>
                </label>
                <label>
                  מקום תשלום
                  <strong>{modal.row.meta?.paymentPlace || "—"}</strong>
                </label>
              </>
            ) : (
              (modal.type === "view" ? data.columns : editableColumns).map((c) => (
                <label key={c.key}>
                  {c.label}
                  {modal.type === "view" ? (
                    <strong>{form[c.key] || "—"}</strong>
                  ) : c.options ? (
                    <select value={form[c.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}>
                      {c.options.map((o) => (
                        <option key={o.value} value={o.label}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={form[c.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))} />
                  )}
                </label>
              ))
            )}
            {modal.type !== "view" ? (
              <div className="adm-mini-modal-actions">
                <button type="button" className="adm-btn adm-btn--primary" onClick={() => void save(modal.type === "edit" ? modal.row.id : undefined)}>
                  שמירה
                </button>
                <button type="button" className="adm-btn adm-btn--ghost" onClick={() => startModal(null)}>
                  ביטול
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
