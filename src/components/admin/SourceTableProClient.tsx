"use client";

import { useEffect, useMemo, useState } from "react";
import {
  deleteSourceTableRowsAction,
  listSourceTableDataAction,
  upsertSourceTableRowAction,
  type SourceTableData,
  type SourceTableId,
  type SourceTableRow,
} from "@/app/admin/source-tables/actions";
import { Modal } from "@/components/ui/Modal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

type Props = {
  tableId: SourceTableId;
  initialData: SourceTableData;
  initialSearch?: string;
};

type ModalState =
  | { type: "view"; row: SourceTableRow }
  | { type: "edit"; row: SourceTableRow }
  | { type: "payment"; row: SourceTableRow }
  | { type: "add" }
  | null;

function toneClass(tone: SourceTableRow["tone"]) {
  return `adm-source-pro-row--${tone || "neutral"}`;
}

export function SourceTableProClient({ tableId, initialData, initialSearch = "" }: Props) {
  const { openWindow } = useAdminWindows();
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState(initialSearch);
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(initialData.page);
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const debouncedKey = useMemo(() => JSON.stringify({ search, status, customer, page, sortKey, sortDir }), [search, status, customer, page, sortKey, sortDir]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLoading(true);
      void listSourceTableDataAction(tableId, {
        page,
        limit: 15,
        search,
        sortKey,
        sortDir,
        filters: { status, customer },
      }).then((next) => {
        if (next) setData(next);
        setLoading(false);
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [debouncedKey, tableId, page, search, status, customer, sortKey, sortDir]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void listSourceTableDataAction(tableId, { page, limit: 15, search, sortKey, sortDir, filters: { status, customer } }).then((next) => {
        if (next) setData(next);
      });
    }, 15000);
    return () => window.clearInterval(t);
  }, [tableId, page, search, sortKey, sortDir, status, customer]);

  function startModal(next: ModalState) {
    setModal(next);
    if (!next) {
      setForm({});
      return;
    }
    if (next.type === "add") {
      setForm(Object.fromEntries(data.columns.filter((c) => c.editable).map((c) => [c.key, ""])));
      return;
    }
    setForm(next.row.cells);
  }

  function toggleSelected(id: string) {
    setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  }

  async function refresh() {
    const next = await listSourceTableDataAction(tableId, { page, limit: 15, search, sortKey, sortDir, filters: { status, customer } });
    if (next) setData(next);
  }

  async function save(rowId?: string) {
    setErr(null);
    const res = await upsertSourceTableRowAction({ table: tableId, id: rowId, values: form });
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    startModal(null);
    await refresh();
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
    await refresh();
  }

  function openLinked(row: SourceTableRow) {
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

  async function changeOrderStatus(row: SourceTableRow, statusLabel: string) {
    const values = { ...row.cells, status: statusLabel };
    setData((old) => ({
      ...old,
      rows: old.rows.map((r) => (r.id === row.id ? { ...r, cells: values } : r)),
    }));
    const res = await upsertSourceTableRowAction({ table: tableId, id: row.id, values });
    if (!res.ok) setErr(res.error);
    else await refresh();
  }

  const editableColumns = data.columns.filter((c) => c.editable);

  return (
    <div className="adm-source-pro">
      <div className="adm-source-pro-toolbar">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="חיפוש חכם: שם, קוד, טלפון, סכום..."
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          סינון 🔍
        </button>
        {data.canAdd ? (
          <button type="button" className="adm-btn adm-btn--primary" onClick={() => startModal({ type: "add" })}>
            + הוסף
          </button>
        ) : null}
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void refresh()}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters">
          <label>
            סטטוס
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">הכל</option>
              {data.columns.find((c) => c.key === "status")?.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
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
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={() => void deleteRows(selected)}>
            מחק
          </button>
        </div>
      ) : null}

      {err ? <div className="adm-error">{err}</div> : null}

      <div className="adm-source-pro-table-wrap" aria-busy={loading}>
        {loading ? <div className="adm-source-pro-loading">טוען...</div> : null}
        <table className="adm-table adm-source-pro-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={data.rows.length > 0 && selected.length === data.rows.length}
                  onChange={(e) => setSelected(e.target.checked ? data.rows.map((r) => r.id) : [])}
                />
              </th>
              {data.columns.map((col) => (
                <th key={col.key}>
                  <button
                    type="button"
                    className="adm-source-sort-btn"
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
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={data.columns.length + 2} className="adm-table-empty">אין נתונים להצגה.</td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.id} className={`adm-source-pro-row ${toneClass(r.tone)}`} onDoubleClick={() => openLinked(r)}>
                  <td>
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelected(r.id)} />
                  </td>
                  {data.columns.map((c, idx) => (
                    <td key={c.key}>
                      {tableId === "orders" && c.key === "status" && c.options ? (
                        <select
                          className="adm-source-status-inline"
                          value={r.cells.status || ""}
                          onChange={(e) => void changeOrderStatus(r, e.target.value)}
                          aria-label="שינוי סטטוס הזמנה"
                        >
                          {c.options.map((o) => (
                            <option key={o.value} value={o.label}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : tableId === "orders" && c.key === "customer" ? (
                        <button type="button" className="adm-source-primary-link" onClick={() => openCustomer(r)} disabled={!r.meta?.customerId}>
                          {r.cells[c.key] || "—"}
                        </button>
                      ) : tableId === "orders" && c.key === "payment" ? (
                        <button type="button" className="adm-source-primary-link" onClick={() => openPayment(r)} disabled={!r.meta?.paymentId}>
                          {r.cells[c.key] || "אין תשלום"}
                        </button>
                      ) : idx === 0 ? (
                        <button type="button" className="adm-source-primary-link" onClick={() => openLinked(r)}>
                          {r.cells[c.key] || "—"}
                        </button>
                      ) : (
                        <span>{r.cells[c.key] || "—"}</span>
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="adm-source-row-actions">
                      <button type="button" onClick={() => startModal({ type: "view", row: r })}>👁 צפייה</button>
                      {editableColumns.length ? <button type="button" onClick={() => startModal({ type: "edit", row: r })}>✏️ ערוך</button> : null}
                      <button type="button" onClick={() => void deleteRows([r.id])}>🗑 מחק</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {data.summary ? (
            <tfoot>
              <tr>
                <td colSpan={data.columns.length + 2}>
                  <div className="adm-source-summary-row">
                    {data.summary.total ? <span>סה"כ: <strong>{data.summary.total}</strong></span> : null}
                    {data.summary.paid ? <span>שולם: <strong>{data.summary.paid}</strong></span> : null}
                    {data.summary.remaining ? <span>נשאר: <strong>{data.summary.remaining}</strong></span> : null}
                  </div>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="adm-source-pro-pagination">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
        <span>{data.page} / {data.totalPages}</span>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}>Next</button>
      </div>

      <Modal open={!!modal} onClose={() => startModal(null)} title={modal?.type === "add" ? "הוספה" : modal?.type === "edit" ? "עריכה" : modal?.type === "payment" ? "אישור תשלום" : "צפייה"} size="lg">
        {modal ? (
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
            ) : (modal.type === "view" ? data.columns : editableColumns).map((c) => (
              <label key={c.key}>
                {c.label}
                {modal.type === "view" ? (
                  <strong>{form[c.key] || "—"}</strong>
                ) : c.options ? (
                  <select value={form[c.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}>
                    {c.options.map((o) => (
                      <option key={o.value} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input value={form[c.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))} />
                )}
              </label>
            ))}
            {modal.type !== "view" ? (
              <div className="adm-mini-modal-actions">
                <button type="button" className="adm-btn adm-btn--primary" onClick={() => void save(modal.type === "edit" ? modal.row.id : undefined)}>שמירה</button>
                <button type="button" className="adm-btn adm-btn--ghost" onClick={() => startModal(null)}>ביטול</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
