"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOrderStatusAction,
  deleteOrderStatusAction,
  listOrderStatusesManagerAction,
  reorderOrderStatusesAction,
  updateOrderStatusAction,
  type OrderStatusManagerRow,
} from "@/app/admin/order-statuses/actions";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { STATUS_COLOR_PRESETS } from "@/lib/order-status-shared";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";

type EditState = { id: string; nameHe: string; colorHex: string; isActive: boolean } | null;
type DeleteState = { id: string; name: string; usageCount: number } | null;
type ActiveFilter = "all" | "active" | "inactive";
type SortKey = "sortOrder" | "nameHe" | "code" | "usageCount" | "isActive";

function colorLabel(hex: string): string {
  const hit = STATUS_COLOR_PRESETS.find((p) => p.hex === hex);
  return hit?.label ?? "צבע";
}

function ColorPreview({ hex }: { hex: string }) {
  return (
    <span className="adm-status-erp-color">
      <span className="adm-status-erp-color__dot" style={{ background: hex }} aria-hidden />
      <span className="adm-status-erp-color__lbl">{colorLabel(hex)}</span>
    </span>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="adm-status-color-pick adm-status-color-pick--compact">
      {STATUS_COLOR_PRESETS.map((p) => (
        <button
          key={p.hex}
          type="button"
          className={value === p.hex ? "adm-status-color-pick__btn is-on" : "adm-status-color-pick__btn"}
          style={{ background: p.hex }}
          title={p.label}
          aria-label={p.label}
          onClick={() => onChange(p.hex)}
        />
      ))}
    </div>
  );
}

export function OrderStatusesManager({ initialSearch = "" }: { initialSearch?: string }) {
  const { refresh: refreshStatusCatalog } = useOrderStatusCatalog();
  const [rows, setRows] = useState<OrderStatusManagerRow[]>([]);
  const [search, setSearch] = useState(initialSearch);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("sortOrder");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addColor, setAddColor] = useState<string>(STATUS_COLOR_PRESETS[0].hex);
  const [addActive, setAddActive] = useState(true);
  const [edit, setEdit] = useState<EditState>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>(null);
  const [replaceId, setReplaceId] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await listOrderStatusesManagerAction(search);
      setRows(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה בטעינה");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 280);
    return () => window.clearTimeout(t);
  }, [load]);

  const activeTags = useMemo(() => rows.filter((t) => t.isActive), [rows]);

  const displayed = useMemo(() => {
    let list = [...rows];
    if (activeFilter === "active") list = list.filter((r) => r.isActive);
    if (activeFilter === "inactive") list = list.filter((r) => !r.isActive);
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "nameHe":
          cmp = a.nameHe.localeCompare(b.nameHe, "he");
          break;
        case "code":
          cmp = a.code.localeCompare(b.code, "he");
          break;
        case "usageCount":
          cmp = a.usageCount - b.usageCount;
          break;
        case "isActive":
          cmp = Number(a.isActive) - Number(b.isActive);
          break;
        default:
          cmp = a.sortOrder - b.sortOrder;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, activeFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "usageCount" ? "desc" : "asc");
    }
  }

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <button type="button" className="adm-status-erp-th-btn" onClick={() => toggleSort(col)}>
        {label}
        <Icon size={14} aria-hidden className={active ? "is-active" : ""} />
      </button>
    );
  }

  async function handleCreate() {
    if (!addName.trim()) return;
    setBusy(true);
    const res = await createOrderStatusAction({
      nameHe: addName.trim(),
      colorHex: addColor,
      isActive: addActive,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setAddOpen(false);
    setAddName("");
    setAddColor(STATUS_COLOR_PRESETS[0].hex);
    setAddActive(true);
    void load();
    refreshStatusCatalog();
  }

  async function handleSaveEdit() {
    if (!edit) return;
    setBusy(true);
    const res = await updateOrderStatusAction(edit.id, {
      nameHe: edit.nameHe,
      colorHex: edit.colorHex,
      isActive: edit.isActive,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setEdit(null);
    void load();
    refreshStatusCatalog();
  }

  async function toggleActive(row: OrderStatusManagerRow) {
    setBusy(true);
    const res = await updateOrderStatusAction(row.id, { isActive: !row.isActive });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    void load();
    refreshStatusCatalog();
  }

  async function tryDelete() {
    if (!deleteState) return;
    setBusy(true);
    const res = await deleteOrderStatusAction(deleteState.id, replaceId || undefined);
    setBusy(false);
    if (!res.ok) {
      if ("usageCount" in res && res.usageCount) {
        setDeleteState({ ...deleteState, usageCount: res.usageCount });
      } else {
        setErr(res.error);
      }
      return;
    }
    setDeleteState(null);
    setReplaceId("");
    void load();
    refreshStatusCatalog();
  }

  async function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = displayed.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setDragId(null);
    await reorderOrderStatusesAction(next);
    void load();
    refreshStatusCatalog();
  }

  async function requestDelete(row: OrderStatusManagerRow) {
    setBusy(true);
    const res = await deleteOrderStatusAction(row.id);
    setBusy(false);
    if (!res.ok && "usageCount" in res && res.usageCount) {
      setDeleteState({ id: row.id, name: row.nameHe, usageCount: res.usageCount });
      setReplaceId(activeTags.find((t) => t.id !== row.id)?.id ?? "");
    } else if (!res.ok) {
      setErr(res.error);
    } else {
      void load();
      refreshStatusCatalog();
    }
  }

  return (
    <div className="adm-status-erp" dir="rtl">
      <header className="adm-status-erp-toolbar">
        <input
          type="search"
          className="adm-status-erp-search"
          placeholder="חיפוש לפי שם, קוד, צבע..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="חיפוש סטטוסים"
        />
        <select
          className="adm-status-erp-filter"
          value={activeFilter}
          aria-label="סינון פעיל"
          onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
        >
          <option value="all">הכל</option>
          <option value="active">פעיל בלבד</option>
          <option value="inactive">לא פעיל</option>
        </select>
        <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={() => setAddOpen(true)}>
          <Plus size={16} aria-hidden />
          סטטוס חדש
        </button>
      </header>

      {err ? (
        <p className="adm-status-erp-err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="adm-status-erp-table-wrap mobile-table-wrapper">
        <table className="adm-status-erp-table">
          <thead>
            <tr>
              <th className="adm-status-erp-col-grip" aria-label="סדר" />
              <th className="adm-status-erp-col-active">
                <SortBtn col="isActive" label="פעיל" />
              </th>
              <th className="adm-status-erp-col-name">
                <SortBtn col="nameHe" label="שם סטטוס" />
              </th>
              <th className="adm-status-erp-col-code">
                <SortBtn col="code" label="קוד מערכת" />
              </th>
              <th className="adm-status-erp-col-color">צבע</th>
              <th className="adm-status-erp-col-sort">
                <SortBtn col="sortOrder" label="סדר" />
              </th>
              <th className="adm-status-erp-col-usage">
                <SortBtn col="usageCount" label="שימושים" />
              </th>
              <th className="adm-status-erp-col-actions">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {addOpen ? (
              <tr className="adm-status-erp-row adm-status-erp-row--add">
                <td colSpan={8}>
                  <div className="adm-status-erp-inline-add">
                    <label>
                      <span>שם סטטוס</span>
                      <input
                        type="text"
                        value={addName}
                        placeholder="לדוגמה: ממתין, בדרך"
                        autoFocus
                        onChange={(e) => setAddName(e.target.value)}
                      />
                    </label>
                    <div className="adm-status-erp-inline-add__color">
                      <span>צבע</span>
                      <ColorPicker value={addColor} onChange={setAddColor} />
                    </div>
                    <label className="adm-status-erp-inline-add__active">
                      <input type="checkbox" checked={addActive} onChange={(e) => setAddActive(e.target.checked)} />
                      <span>פעיל</span>
                    </label>
                    <div className="adm-status-erp-inline-add__btns">
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setAddOpen(false)}>
                        ביטול
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn--primary adm-btn--sm"
                        disabled={busy || !addName.trim()}
                        onClick={() => void handleCreate()}
                      >
                        שמור
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={8} className="adm-status-erp-empty">
                  טוען סטטוסים…
                </td>
              </tr>
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={8} className="adm-status-erp-empty">
                  אין סטטוסים — לחץ «סטטוס חדש» להוספה.
                </td>
              </tr>
            ) : (
              displayed.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`adm-status-erp-row${!row.isActive ? " adm-status-erp-row--off" : ""}${idx % 2 === 1 ? " adm-status-erp-row--alt" : ""}${dragId === row.id ? " adm-status-erp-row--drag" : ""}`}
                  draggable
                  onDragStart={() => setDragId(row.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => void onDrop(row.id)}
                >
                  <td className="adm-status-erp-col-grip" data-label="">
                    <span className="adm-status-erp-grip" aria-hidden>
                      <GripVertical size={14} />
                    </span>
                  </td>
                  <td className="adm-status-erp-col-active" data-label="פעיל">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      disabled={busy}
                      aria-label={`${row.isActive ? "כבה" : "הפעל"} ${row.nameHe}`}
                      onChange={() => void toggleActive(row)}
                    />
                  </td>
                  <td className="adm-status-erp-col-name" data-label="שם סטטוס">
                    <strong>{row.nameHe}</strong>
                  </td>
                  <td className="adm-status-erp-col-code" data-label="קוד מערכת">
                    <code className="adm-status-erp-code">{row.code}</code>
                  </td>
                  <td className="adm-status-erp-col-color" data-label="צבע">
                    <ColorPreview hex={row.colorHex} />
                  </td>
                  <td className="adm-status-erp-col-sort" data-label="סדר">
                    {row.sortOrder}
                  </td>
                  <td className="adm-status-erp-col-usage" data-label="שימושים">
                    <span className="adm-status-erp-usage">{row.usageCount.toLocaleString("he-IL")}</span>
                  </td>
                  <td className="adm-status-erp-col-actions" data-label="פעולות">
                    <div className="adm-status-erp-actions">
                      <button
                        type="button"
                        className="adm-status-erp-act"
                        aria-label={`ערוך ${row.nameHe}`}
                        disabled={busy}
                        onClick={() =>
                          setEdit({
                            id: row.id,
                            nameHe: row.nameHe,
                            colorHex: row.colorHex,
                            isActive: row.isActive,
                          })
                        }
                      >
                        <Pencil size={15} />
                        <span>ערוך</span>
                      </button>
                      <button
                        type="button"
                        className="adm-status-erp-act adm-status-erp-act--danger"
                        aria-label={`מחק ${row.nameHe}`}
                        disabled={busy}
                        onClick={() => void requestDelete(row)}
                      >
                        <Trash2 size={15} />
                        <span>מחק</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {edit ? (
        <div className="adm-status-pop-overlay" role="presentation" onClick={() => setEdit(null)}>
          <div className="adm-status-pop" role="dialog" aria-labelledby="edit-status-title" onClick={(e) => e.stopPropagation()}>
            <header className="adm-status-pop__head">
              <h2 id="edit-status-title">עריכת סטטוס</h2>
              <button type="button" className="adm-status-pop__close" aria-label="סגור" onClick={() => setEdit(null)}>
                <X size={18} />
              </button>
            </header>
            <label className="adm-status-pop__field">
              <span>שם סטטוס</span>
              <input type="text" value={edit.nameHe} onChange={(e) => setEdit({ ...edit, nameHe: e.target.value })} />
            </label>
            <div className="adm-status-pop__field">
              <span>צבע</span>
              <ColorPicker value={edit.colorHex} onChange={(hex) => setEdit({ ...edit, colorHex: hex })} />
            </div>
            <label className="adm-status-pop__toggle">
              <input
                type="checkbox"
                checked={edit.isActive}
                onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })}
              />
              <span>פעיל</span>
            </label>
            <div className="adm-status-pop__actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEdit(null)}>
                ביטול
              </button>
              <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={busy} onClick={() => void handleSaveEdit()}>
                שמור
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteState ? (
        <div className="adm-status-pop-overlay" role="presentation" onClick={() => setDeleteState(null)}>
          <div className="adm-status-pop adm-status-pop--wide" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <header className="adm-status-pop__head">
              <h2>הסטטוס בשימוש</h2>
              <button type="button" className="adm-status-pop__close" aria-label="סגור" onClick={() => setDeleteState(null)}>
                <X size={18} />
              </button>
            </header>
            <p>
              «{deleteState.name}» מופיע ב־<strong>{deleteState.usageCount}</strong> הזמנות. העבר להזמנות לסטטוס אחר לפני מחיקה.
            </p>
            <label className="adm-status-pop__field">
              <span>העבר לסטטוס</span>
              <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)}>
                <option value="">— בחר סטטוס —</option>
                {activeTags
                  .filter((t) => t.id !== deleteState.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameHe}
                    </option>
                  ))}
              </select>
            </label>
            <div className="adm-status-pop__actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setDeleteState(null)}>
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--sm"
                disabled={busy || !replaceId}
                onClick={() => void tryDelete()}
              >
                העבר ומחק
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
