"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SyncedTableScroll } from "@/components/admin/shipments/SyncedTableScroll";
import {
  createManualShipmentAction,
  updateManualShipmentAction,
  deleteManualShipmentAction,
  deleteManualShipmentsAction,
  listManualShipmentsAction,
} from "@/app/admin/shipments/manual/actions";
import {
  AUTOCOMPLETE_COLUMN_KEYS,
  CLEAR_ON_DUPLICATE_KEYS,
  MANUAL_SHIPMENT_COLUMNS,
  SESSION_DEFAULTS_KEY,
  STICKY_COLUMN_KEYS,
  type ManualColumnKey,
} from "@/app/admin/shipments/manual/columns";
import {
  MANUAL_SHIPMENT_STATUSES,
  statusLabel,
  type ManualShipmentDto,
  type ManualShipmentFilters,
  type ManualShipmentInput,
} from "@/app/admin/shipments/manual/types";

type Mode = "create" | "edit" | "view" | null;
type FormState = Record<ManualColumnKey, string>;
type EditTarget = { rowId: string; colIndex: number } | null;

const DRAFT_ID = "__draft__";
const COL_KEYS = MANUAL_SHIPMENT_COLUMNS.map((c) => c.key);
const COL_COUNT = MANUAL_SHIPMENT_COLUMNS.length + 2;

const emptyForm = (): FormState => {
  const f = {} as FormState;
  for (const col of MANUAL_SHIPMENT_COLUMNS) {
    f[col.key] = col.key === "status" ? "NEW" : "";
  }
  return f;
};

function dtoToForm(row: ManualShipmentDto): FormState {
  return {
    entryDate: row.entryDate ?? "",
    monthKey: row.monthKey ?? "",
    country: row.country ?? "",
    shipmentNumber: row.shipmentNumber ?? "",
    containerNumber: row.containerNumber ?? "",
    shipmentDetails: row.shipmentDetails ?? "",
    status: row.status || "NEW",
    city: row.city ?? "",
    cpm: row.cpm ?? "",
    orderNumber: row.orderNumber ?? "",
    vatAmount: row.vatAmount != null ? String(row.vatAmount) : "",
    amountTotal: row.amountTotal != null ? String(row.amountTotal) : "",
    airjetInvoice: row.airjetInvoice ?? "",
    amountPaid: row.amountPaid != null ? String(row.amountPaid) : "",
    makasa: row.makasa ?? "",
    makasaNumber: row.makasaNumber ?? "",
    inlandHaulage: row.inlandHaulage != null ? String(row.inlandHaulage) : "",
    portHaulage: row.portHaulage != null ? String(row.portHaulage) : "",
  };
}

function formToInput(f: FormState): ManualShipmentInput {
  const n = (v: string) => {
    const t = v.trim();
    if (!t) return null;
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
  };
  return {
    entryDate: f.entryDate || null,
    monthKey: f.monthKey || null,
    country: f.country || null,
    shipmentNumber: f.shipmentNumber || null,
    containerNumber: f.containerNumber || null,
    shipmentDetails: f.shipmentDetails || null,
    status: f.status || "NEW",
    city: f.city || null,
    cpm: f.cpm || null,
    orderNumber: f.orderNumber || null,
    vatAmount: n(f.vatAmount),
    amountTotal: n(f.amountTotal),
    airjetInvoice: f.airjetInvoice || null,
    amountPaid: n(f.amountPaid),
    makasa: f.makasa || null,
    makasaNumber: f.makasaNumber || null,
    inlandHaulage: n(f.inlandHaulage),
    portHaulage: n(f.portHaulage),
  };
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

function cellValue(row: ManualShipmentDto, key: ManualColumnKey): string {
  const f = dtoToForm(row);
  if (key === "status") return statusLabel(row.status);
  if (
    key === "vatAmount" ||
    key === "amountTotal" ||
    key === "amountPaid" ||
    key === "inlandHaulage" ||
    key === "portHaulage"
  ) {
    const n = Number(f[key]);
    return f[key] ? fmtMoney(n) : "—";
  }
  return f[key] || "—";
}

function loadSessionDefaults(): Partial<FormState> {
  try {
    const raw = sessionStorage.getItem(SESSION_DEFAULTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<FormState>;
  } catch {
    return {};
  }
}

function saveSessionDefaults(form: FormState) {
  const sticky: Partial<FormState> = {};
  for (const key of STICKY_COLUMN_KEYS) {
    if (form[key]?.trim()) sticky[key] = form[key];
  }
  try {
    sessionStorage.setItem(SESSION_DEFAULTS_KEY, JSON.stringify(sticky));
  } catch {
    /* ignore */
  }
}

function formWithDefaults(base?: Partial<FormState>): FormState {
  const next = emptyForm();
  const sticky = { ...loadSessionDefaults(), ...base };
  for (const key of STICKY_COLUMN_KEYS) {
    if (sticky[key]) next[key] = sticky[key]!;
  }
  if (!next.entryDate) {
    next.entryDate = new Date().toISOString().slice(0, 10);
  }
  if (!next.monthKey && next.entryDate) {
    next.monthKey = next.entryDate.slice(0, 7);
  }
  return next;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "NEW":
      return "msh-status msh-status--new";
    case "IN_TRANSIT":
      return "msh-status msh-status--transit";
    case "ARRIVED":
      return "msh-status msh-status--arrived";
    case "IN_DISTRIBUTION":
      return "msh-status msh-status--dist";
    case "COMPLETED":
      return "msh-status msh-status--done";
    case "CANCELLED":
      return "msh-status msh-status--cancel";
    default:
      return "msh-status";
  }
}

function statusRowClass(status: string): string {
  switch (status) {
    case "NEW":
      return "msh-row--new";
    case "IN_TRANSIT":
      return "msh-row--transit";
    case "ARRIVED":
      return "msh-row--arrived";
    case "IN_DISTRIBUTION":
      return "msh-row--dist";
    case "COMPLETED":
      return "msh-row--done";
    case "CANCELLED":
      return "msh-row--cancel";
    default:
      return "";
  }
}

type Props = { initialRows: ManualShipmentDto[] };

export function ShipmentManualEntryClient({ initialRows }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState<ManualShipmentFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<FormState | null>(null);
  const [inlineEdit, setInlineEdit] = useState<FormState | null>(null);
  const [inlineRowId, setInlineRowId] = useState<string | null>(null);
  const [focusCell, setFocusCell] = useState<EditTarget>(null);
  const [keepShipmentNumber, setKeepShipmentNumber] = useState(true);
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>>(
    new Map(),
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.amountTotal += r.amountTotal ?? 0;
        acc.amountPaid += r.amountPaid ?? 0;
        acc.vatAmount += r.vatAmount ?? 0;
        acc.inlandHaulage += r.inlandHaulage ?? 0;
        acc.portHaulage += r.portHaulage ?? 0;
        return acc;
      },
      { amountTotal: 0, amountPaid: 0, vatAmount: 0, inlandHaulage: 0, portHaulage: 0 },
    );
  }, [rows]);

  const suggestions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const key of AUTOCOMPLETE_COLUMN_KEYS) {
      const set = new Set<string>();
      if (key === "status") {
        MANUAL_SHIPMENT_STATUSES.forEach((s) => set.add(s.label));
      }
      for (const r of rows) {
        const v = dtoToForm(r)[key]?.trim();
        if (v) set.add(v);
      }
      map[key] = [...set].sort((a, b) => a.localeCompare(b, "he"));
    }
    return map;
  }, [rows]);

  const refresh = useCallback(
    (f: ManualShipmentFilters = filters) => {
      startTransition(async () => {
        const res = await listManualShipmentsAction(f);
        if (res.ok) {
          setRows(res.rows);
          setSelected(new Set());
        } else {
          setError(res.error);
        }
      });
    },
    [filters],
  );

  useEffect(() => {
    if (!focusCell) return;
    const key = `${focusCell.rowId}:${focusCell.colIndex}`;
    const el = inputRefs.current.get(key);
    if (el) {
      el.focus();
      if ("select" in el && typeof el.select === "function" && el.tagName !== "SELECT") {
        try {
          el.select();
        } catch {
          /* ignore */
        }
      }
    }
  }, [focusCell, draft, inlineEdit]);

  function refKey(rowId: string, colIndex: number) {
    return `${rowId}:${colIndex}`;
  }

  function setInputRef(
    rowId: string,
    colIndex: number,
    el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null,
  ) {
    const k = refKey(rowId, colIndex);
    if (el) inputRefs.current.set(k, el);
    else inputRefs.current.delete(k);
  }

  function moveFocus(rowId: string, colIndex: number, delta: number) {
    let next = colIndex + delta;
    if (next < 0) next = 0;
    if (next >= COL_KEYS.length) {
      if (rowId === DRAFT_ID) {
        void saveDraft();
        return;
      }
      if (inlineRowId === rowId) {
        void saveInlineRow();
        return;
      }
      next = COL_KEYS.length - 1;
    }
    setFocusCell({ rowId, colIndex: next });
  }

  function startNewRow() {
    if (draft) {
      setFocusCell({ rowId: DRAFT_ID, colIndex: 0 });
      return;
    }
    if (inlineRowId) {
      void saveInlineRow().then((ok) => {
        if (ok) {
          const next = formWithDefaults(
            keepShipmentNumber ? undefined : { shipmentNumber: "" },
          );
          if (!keepShipmentNumber) next.shipmentNumber = "";
          setDraft(next);
          setFocusCell({ rowId: DRAFT_ID, colIndex: 0 });
        }
      });
      return;
    }
    const next = formWithDefaults();
    if (!keepShipmentNumber) next.shipmentNumber = "";
    setDraft(next);
    setFocusCell({ rowId: DRAFT_ID, colIndex: 0 });
    setError(null);
  }

  function cancelDraft() {
    setDraft(null);
    setFocusCell(null);
  }

  async function saveDraft(): Promise<boolean> {
    if (!draft) return false;
    const input = formToInput(draft);
    setError(null);
    const res = await createManualShipmentAction(input);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    saveSessionDefaults(draft);
    setDraft(null);
    setFocusCell(null);
    refresh();
    return true;
  }

  function beginInlineEdit(row: ManualShipmentDto, colIndex = 0) {
    if (draft) {
      setError("שמור או בטל את השורה החדשה לפני עריכת שורה קיימת");
      return;
    }
    setInlineRowId(row.id);
    setInlineEdit(dtoToForm(row));
    setFocusCell({ rowId: row.id, colIndex });
    setError(null);
  }

  function cancelInline() {
    setInlineRowId(null);
    setInlineEdit(null);
    setFocusCell(null);
  }

  async function saveInlineRow(): Promise<boolean> {
    if (!inlineRowId || !inlineEdit) return false;
    const res = await updateManualShipmentAction(inlineRowId, formToInput(inlineEdit));
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    saveSessionDefaults(inlineEdit);
    setRows((prev) =>
      prev.map((r) =>
        r.id === inlineRowId
          ? {
              ...r,
              ...Object.fromEntries(
                Object.entries(formToInput(inlineEdit)).map(([k, v]) => [k, v ?? null]),
              ),
              status: inlineEdit.status || r.status,
              entryDate: inlineEdit.entryDate || null,
              monthKey: inlineEdit.monthKey || null,
              updatedAt: new Date().toISOString(),
            }
          : r,
      ) as ManualShipmentDto[],
    );
    cancelInline();
    refresh();
    return true;
  }

  function patchDraft(key: ManualColumnKey, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "entryDate" && value && !prev.monthKey) next.monthKey = value.slice(0, 7);
      return next;
    });
  }

  function patchInline(key: ManualColumnKey, value: string) {
    setInlineEdit((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "entryDate" && value && !prev.monthKey) next.monthKey = value.slice(0, 7);
      return next;
    });
  }

  function duplicateAsDraft(row: ManualShipmentDto) {
    if (draft) {
      setError("שמור או בטל את השורה החדשה לפני שכפול");
      return;
    }
    if (inlineRowId) cancelInline();
    const base = dtoToForm(row);
    for (const key of CLEAR_ON_DUPLICATE_KEYS) {
      base[key] = "";
    }
    setDraft(base);
    setFocusCell({ rowId: DRAFT_ID, colIndex: COL_KEYS.indexOf("shipmentNumber") });
    setError(null);
  }

  function onCellKeyDown(
    e: ReactKeyboardEvent,
    rowId: string,
    colIndex: number,
  ) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (rowId === DRAFT_ID) cancelDraft();
      else cancelInline();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      moveFocus(rowId, colIndex, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      moveFocus(rowId, colIndex, 1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveFocus(rowId, colIndex, -1); // RTL: right = previous
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveFocus(rowId, colIndex, 1);
      return;
    }
  }

  function openCreate() {
    setForm(formWithDefaults());
    setEditId(null);
    setMode("create");
    setError(null);
  }

  function openEdit(row: ManualShipmentDto) {
    setForm(dtoToForm(row));
    setEditId(row.id);
    setMode("edit");
    setError(null);
  }

  function openView(row: ManualShipmentDto) {
    setForm(dtoToForm(row));
    setEditId(row.id);
    setMode("view");
    setError(null);
  }

  function closeModal() {
    setMode(null);
    setEditId(null);
    setError(null);
  }

  function setField(key: ManualColumnKey, value: string) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "entryDate" && value && !prev.monthKey) next.monthKey = value.slice(0, 7);
      return next;
    });
  }

  function saveModal() {
    const input = formToInput(form);
    startTransition(async () => {
      setError(null);
      if (mode === "create") {
        const res = await createManualShipmentAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        saveSessionDefaults(form);
      } else if (mode === "edit" && editId) {
        const res = await updateManualShipmentAction(editId, input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        saveSessionDefaults(form);
      }
      closeModal();
      refresh();
    });
  }

  function onDelete(id: string) {
    if (!confirm("למחוק את המשלוח הידני?")) return;
    startTransition(async () => {
      const res = await deleteManualShipmentAction(id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      refresh();
    });
  }

  function onDeleteSelected() {
    if (!selected.size) return;
    if (!confirm(`למחוק ${selected.size} רשומות מסומנות?`)) return;
    startTransition(async () => {
      const res = await deleteManualShipmentsAction([...selected]);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      refresh();
    });
  }

  function renderEditableCell(
    rowId: string,
    colIndex: number,
    value: string,
    onChange: (v: string) => void,
  ) {
    const col = MANUAL_SHIPMENT_COLUMNS[colIndex]!;
    const listId = col.autocomplete ? `msh-ac-${col.key}` : undefined;
    const bindRef = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) =>
      setInputRef(rowId, colIndex, el);
    const onKey = (e: ReactKeyboardEvent) => onCellKeyDown(e, rowId, colIndex);

    if (col.input === "status") {
      return (
        <select
          ref={bindRef}
          className="msh-excel-input"
          disabled={pending}
          value={value || "NEW"}
          onKeyDown={onKey}
          onChange={(e) => onChange(e.target.value)}
        >
          {MANUAL_SHIPMENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      );
    }
    if (col.input === "textarea") {
      return (
        <textarea
          ref={bindRef}
          className="msh-excel-input"
          disabled={pending}
          rows={1}
          value={value}
          onKeyDown={onKey}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    return (
      <input
        ref={bindRef}
        className="msh-excel-input"
        disabled={pending}
        type={col.input === "text" ? "text" : col.input}
        step={col.step}
        value={value}
        list={listId}
        onKeyDown={onKey}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  function renderDisplayCell(row: ManualShipmentDto, colIndex: number) {
    const col = MANUAL_SHIPMENT_COLUMNS[colIndex]!;
    const display = cellValue(row, col.key);
    return (
      <button
        type="button"
        className="msh-excel-cell"
        title="לחיצה כפולה לעריכה"
        onDoubleClick={() => beginInlineEdit(row, colIndex)}
      >
        {col.key === "status" ? (
          <span className={statusBadgeClass(row.status)}>{statusLabel(row.status)}</span>
        ) : (
          display
        )}
      </button>
    );
  }

  const readOnly = mode === "view";

  function footerCell(key: ManualColumnKey): string | null {
    if (key === "amountTotal") return fmtMoney(totals.amountTotal);
    if (key === "amountPaid") return fmtMoney(totals.amountPaid);
    if (key === "vatAmount") return fmtMoney(totals.vatAmount);
    if (key === "inlandHaulage") return fmtMoney(totals.inlandHaulage);
    if (key === "portHaulage") return fmtMoney(totals.portHaulage);
    return null;
  }

  return (
    <div className="shp-page shp-page--wide msh-page">
      {/* datalists for autocomplete */}
      {AUTOCOMPLETE_COLUMN_KEYS.filter((key) => key !== "status").map((key) => (
        <datalist key={key} id={`msh-ac-${key}`}>
          {(suggestions[key] ?? []).map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}

      <header className="shp-header msh-header">
        <h1>משלוחים – הזנה ידנית</h1>
        <div className="shp-header-actions">
          <button type="button" className="shp-btn shp-btn--success" onClick={startNewRow} disabled={pending}>
            + שורה חדשה
          </button>
          <button type="button" className="shp-btn shp-btn--primary" onClick={openCreate}>
            הוסף משלוח ידני
          </button>
          <label className="msh-keep-shipment" title="שמור מספר משלוח לשורה הבאה">
            <input
              type="checkbox"
              checked={keepShipmentNumber}
              onChange={(e) => setKeepShipmentNumber(e.target.checked)}
            />
            שמור מס׳ משלוח לשורה הבאה
          </label>
        </div>
      </header>

      <div className="msh-filters">
        <input
          className="msh-input"
          placeholder="מספר משלוח"
          value={filters.shipmentNumber ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, shipmentNumber: e.target.value }))}
        />
        <input
          className="msh-input"
          placeholder="מספר קונטיינר"
          value={filters.containerNumber ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, containerNumber: e.target.value }))}
        />
        <input
          className="msh-input"
          placeholder="מדינה"
          value={filters.country ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}
        />
        <input
          className="msh-input"
          type="month"
          title="חודש"
          value={filters.monthKey ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, monthKey: e.target.value }))}
        />
        <select
          className="msh-input"
          value={filters.status ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">כל הסטטוסים</option>
          {MANUAL_SHIPMENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="shp-btn shp-btn--primary"
          onClick={() => refresh(filters)}
          disabled={pending}
        >
          סנן
        </button>
        <button
          type="button"
          className="shp-btn"
          onClick={() => {
            setFilters({});
            refresh({});
          }}
          disabled={pending}
        >
          נקה מסננים
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--danger"
          onClick={onDeleteSelected}
          disabled={!selected.size || pending}
        >
          מחק מסומנים ({selected.size})
        </button>
      </div>

      {error && <div className="msh-error">{error}</div>}

      {draft && (
        <div className="msh-excel-hint">
          שורה חדשה פתוחה · Tab / Enter למעבר · ✔ שמירה · Esc לביטול
        </div>
      )}

      <SyncedTableScroll className="msh-table-scroll">
        <table className="shp-table msh-table">
          <thead>
            <tr>
              <th className="msh-col-check">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                  }
                  aria-label="בחר הכול"
                />
              </th>
              {MANUAL_SHIPMENT_COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              <th className="msh-col-actions">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {draft && (
              <tr className="msh-row--draft">
                <td />
                {MANUAL_SHIPMENT_COLUMNS.map((col, colIndex) => (
                  <td key={col.key}>
                    {renderEditableCell(DRAFT_ID, colIndex, draft[col.key], (v) =>
                      patchDraft(col.key, v),
                    )}
                  </td>
                ))}
                <td className="msh-actions">
                  <button
                    type="button"
                    className="msh-link msh-link--ok"
                    disabled={pending}
                    onClick={() => void saveDraft()}
                  >
                    ✔ שמירה
                  </button>
                  <button type="button" className="msh-link" onClick={cancelDraft}>
                    ביטול
                  </button>
                </td>
              </tr>
            )}

            {rows.length === 0 && !draft ? (
              <tr>
                <td colSpan={COL_COUNT} className="msh-empty">
                  אין משלוחים. לחץ על &quot;+ שורה חדשה&quot; להזנה כמו Excel, או על &quot;הוסף משלוח ידני&quot; לטופס.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const editing = inlineRowId === r.id && inlineEdit;
                return (
                  <tr key={r.id} className={statusRowClass(r.status)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    {MANUAL_SHIPMENT_COLUMNS.map((col, colIndex) => (
                      <td
                        key={col.key}
                        className={
                          col.input === "number"
                            ? "msh-num"
                            : col.key === "shipmentDetails"
                              ? "msh-clamp"
                              : undefined
                        }
                      >
                        {editing
                          ? renderEditableCell(r.id, colIndex, inlineEdit![col.key], (v) =>
                              patchInline(col.key, v),
                            )
                          : renderDisplayCell(r, colIndex)}
                      </td>
                    ))}
                    <td className="msh-actions">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="msh-link msh-link--ok"
                            disabled={pending}
                            onClick={() => void saveInlineRow()}
                          >
                            ✔ שמירה
                          </button>
                          <button type="button" className="msh-link" onClick={cancelInline}>
                            ביטול
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="msh-link" onClick={() => openView(r)}>
                            צפייה
                          </button>
                          <button type="button" className="msh-link" onClick={() => beginInlineEdit(r)}>
                            עריכה
                          </button>
                          <button
                            type="button"
                            className="msh-link"
                            title="שכפל שורה"
                            onClick={() => duplicateAsDraft(r)}
                          >
                            📄 שכפל
                          </button>
                          <button
                            type="button"
                            className="msh-link msh-link--danger"
                            onClick={() => onDelete(r.id)}
                            disabled={pending}
                          >
                            מחיקה
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td>סיכום ({rows.length})</td>
                {MANUAL_SHIPMENT_COLUMNS.map((col) => {
                  const v = footerCell(col.key);
                  return (
                    <td key={col.key} className={v != null ? "msh-num" : undefined}>
                      {v ?? ""}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </SyncedTableScroll>

      {mode && (
        <div className="msh-modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="msh-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="msh-modal__head">
              <h2>
                {mode === "create"
                  ? "הוסף משלוח ידני"
                  : mode === "edit"
                    ? "עריכת משלוח ידני"
                    : "צפייה במשלוח ידני"}
              </h2>
              <button type="button" className="shp-btn" onClick={closeModal}>
                סגור
              </button>
            </div>
            {error && <div className="msh-error">{error}</div>}
            <div className="msh-form">
              <div className="msh-grid msh-grid--excel">
                {MANUAL_SHIPMENT_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className={col.input === "textarea" ? "msh-span-2" : undefined}
                  >
                    {col.label}
                    {col.input === "status" ? (
                      <select
                        disabled={readOnly}
                        value={form.status}
                        onChange={(e) => setField("status", e.target.value)}
                      >
                        {MANUAL_SHIPMENT_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ) : col.input === "textarea" ? (
                      <textarea
                        disabled={readOnly}
                        rows={2}
                        value={form[col.key]}
                        onChange={(e) => setField(col.key, e.target.value)}
                      />
                    ) : (
                      <input
                        type={col.input === "text" ? "text" : col.input}
                        step={col.step}
                        disabled={readOnly}
                        value={form[col.key]}
                        list={col.autocomplete ? `msh-ac-${col.key}` : undefined}
                        onChange={(e) => setField(col.key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="msh-modal__foot">
              <button type="button" className="shp-btn" onClick={closeModal}>
                {readOnly ? "סגור" : "ביטול"}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="shp-btn shp-btn--primary"
                  onClick={saveModal}
                  disabled={pending}
                >
                  {pending ? "שומר…" : "שמור"}
                </button>
              )}
              {readOnly && editId && (
                <button type="button" className="shp-btn shp-btn--primary" onClick={() => setMode("edit")}>
                  עריכה
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
