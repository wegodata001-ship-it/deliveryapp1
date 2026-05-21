"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOrderStatusAction,
  deleteOrderStatusAction,
  listOrderStatusesManagerAction,
  reorderOrderStatusesAction,
  updateOrderStatusAction,
} from "@/app/admin/order-statuses/actions";
import { STATUS_COLOR_PRESETS, type OrderStatusTag } from "@/lib/order-status-registry";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";

type EditState = { id: string; nameHe: string; colorHex: string; isActive: boolean } | null;
type DeleteState = { id: string; name: string; usageCount: number } | null;

export function OrderStatusesManager({ initialSearch = "" }: { initialSearch?: string }) {
  const [tags, setTags] = useState<OrderStatusTag[]>([]);
  const [search, setSearch] = useState(initialSearch);
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
      const rows = await listOrderStatusesManagerAction(search);
      setTags(rows);
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

  const activeTags = useMemo(() => tags.filter((t) => t.isActive), [tags]);

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
  }

  async function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = tags.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setTags((prev) => {
      const byId = Object.fromEntries(prev.map((t) => [t.id, t]));
      return next.map((id, i) => ({ ...byId[id], sortOrder: i * 10 }));
    });
    setDragId(null);
    await reorderOrderStatusesAction(next);
    void load();
  }

  return (
    <div className="adm-status-tags-page" dir="rtl">
      <div className="adm-status-tags-toolbar">
        <input
          type="search"
          className="adm-status-tags-search"
          placeholder="חיפוש לפי שם, צבע, פעיל..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="חיפוש סטטוסים"
        />
        <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={() => setAddOpen(true)}>
          <Plus size={16} aria-hidden />
          סטטוס חדש
        </button>
      </div>

      {err ? (
        <p className="adm-status-tags-err" role="alert">
          {err}
        </p>
      ) : null}

      {loading ? (
        <p className="adm-status-tags-loading">טוען סטטוסים…</p>
      ) : tags.length === 0 ? (
        <p className="adm-status-tags-empty">אין סטטוסים — לחץ «סטטוס חדש» להוספה.</p>
      ) : (
        <ul className="adm-status-tags-grid" aria-label="רשימת סטטוסים">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className={`adm-status-tag-card${!tag.isActive ? " adm-status-tag-card--off" : ""}${dragId === tag.id ? " adm-status-tag-card--drag" : ""}`}
              draggable
              onDragStart={() => setDragId(tag.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDrop(tag.id)}
            >
              <span className="adm-status-tag-card__grip" aria-hidden>
                <GripVertical size={14} />
              </span>
              <button
                type="button"
                className="adm-status-tag-card__main"
                onClick={() =>
                  setEdit({
                    id: tag.id,
                    nameHe: tag.nameHe,
                    colorHex: tag.colorHex,
                    isActive: tag.isActive,
                  })
                }
              >
                <span className="adm-status-tag-card__dot" style={{ background: tag.colorHex }} aria-hidden />
                <span className="adm-status-tag-card__name">{tag.nameHe}</span>
                <span className="adm-status-tag-card__state">{tag.isActive ? "פעיל" : "כבוי"}</span>
              </button>
              <div className="adm-status-tag-card__actions">
                <button
                  type="button"
                  className="adm-status-tag-card__icon-btn"
                  aria-label={`עריכה ${tag.nameHe}`}
                  onClick={() =>
                    setEdit({
                      id: tag.id,
                      nameHe: tag.nameHe,
                      colorHex: tag.colorHex,
                      isActive: tag.isActive,
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="adm-status-tag-card__icon-btn adm-status-tag-card__icon-btn--danger"
                  aria-label={`מחק ${tag.nameHe}`}
                  onClick={async () => {
                    setBusy(true);
                    const res = await deleteOrderStatusAction(tag.id);
                    setBusy(false);
                    if (!res.ok && "usageCount" in res && res.usageCount) {
                      setDeleteState({ id: tag.id, name: tag.nameHe, usageCount: res.usageCount });
                      setReplaceId(activeTags.find((t) => t.id !== tag.id)?.id ?? "");
                    } else if (!res.ok) {
                      setErr(res.error);
                    } else {
                      void load();
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {addOpen ? (
        <div className="adm-status-pop-overlay" role="presentation" onClick={() => setAddOpen(false)}>
          <div
            className="adm-status-pop"
            role="dialog"
            aria-labelledby="add-status-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="adm-status-pop__head">
              <h2 id="add-status-title">סטטוס חדש</h2>
              <button type="button" className="adm-status-pop__close" aria-label="סגור" onClick={() => setAddOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <label className="adm-status-pop__field">
              <span>שם סטטוס</span>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="לדוגמה: ממתין, בדרך, נשלח"
                autoFocus
              />
            </label>
            <div className="adm-status-pop__field">
              <span>צבע</span>
              <div className="adm-status-color-pick">
                {STATUS_COLOR_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    className={addColor === p.hex ? "adm-status-color-pick__btn is-on" : "adm-status-color-pick__btn"}
                    style={{ background: p.hex }}
                    title={p.label}
                    aria-label={p.label}
                    onClick={() => setAddColor(p.hex)}
                  />
                ))}
              </div>
            </div>
            <label className="adm-status-pop__toggle">
              <input type="checkbox" checked={addActive} onChange={(e) => setAddActive(e.target.checked)} />
              <span>פעיל</span>
            </label>
            <div className="adm-status-pop__actions">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setAddOpen(false)}>
                ביטול
              </button>
              <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled={busy} onClick={() => void handleCreate()}>
                שמור
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
              <div className="adm-status-color-pick">
                {STATUS_COLOR_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    className={edit.colorHex === p.hex ? "adm-status-color-pick__btn is-on" : "adm-status-color-pick__btn"}
                    style={{ background: p.hex }}
                    title={p.label}
                    aria-label={p.label}
                    onClick={() => setEdit({ ...edit, colorHex: p.hex })}
                  />
                ))}
              </div>
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
