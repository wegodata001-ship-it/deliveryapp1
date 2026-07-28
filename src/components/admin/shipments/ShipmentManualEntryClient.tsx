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
  CITY_OPTIONS,
  CLEAR_ON_DUPLICATE_KEYS,
  COUNTRY_OPTIONS,
  CUSTOM_STATUSES_KEY,
  MANUAL_SHIPMENT_COLUMNS,
  SESSION_DEFAULTS_KEY,
  SHIPMENT_TYPE_OPTIONS,
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
const COL_COUNT = MANUAL_SHIPMENT_COLUMNS.length + 3;

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

  // ─── Status management ───
  const [customStatuses, setCustomStatuses] = useState<{ value: string; label: string }[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(CUSTOM_STATUSES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showStatusMgmt, setShowStatusMgmt] = useState(false);
  const [newStatusValue, setNewStatusValue] = useState("");
  const [newStatusLabel, setNewStatusLabel] = useState("");

  const allStatuses = useMemo(() => [
    ...MANUAL_SHIPMENT_STATUSES,
    ...customStatuses,
  ], [customStatuses]);

  function addCustomStatus() {
    if (!newStatusValue.trim() || !newStatusLabel.trim()) return;
    const next = [...customStatuses, { value: newStatusValue.trim().toUpperCase(), label: newStatusLabel.trim() }];
    setCustomStatuses(next);
    localStorage.setItem(CUSTOM_STATUSES_KEY, JSON.stringify(next));
    setNewStatusValue("");
    setNewStatusLabel("");
  }

  function removeCustomStatus(value: string) {
    const next = customStatuses.filter((s) => s.value !== value);
    setCustomStatuses(next);
    localStorage.setItem(CUSTOM_STATUSES_KEY, JSON.stringify(next));
  }

  // ─── Context menu state ───
  const [ctxMenuRow, setCtxMenuRow] = useState<string | null>(null);

  // ─── Multi-select filters ───
  const [filterCities, setFilterCities] = useState<Set<string>>(new Set());
  const [filterShipmentTypes, setFilterShipmentTypes] = useState<Set<string>>(new Set());

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

  const displayRows = useMemo(() => {
    let result = rows;
    if (filterCities.size > 0) {
      result = result.filter((r) => r.city && filterCities.has(r.city));
    }
    if (filterShipmentTypes.size > 0) {
      result = result.filter((r) => r.shipmentNumber && filterShipmentTypes.has(r.shipmentNumber));
    }
    return result;
  }, [rows, filterCities, filterShipmentTypes]);

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

  useEffect(() => {
    if (!ctxMenuRow) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".msh-ctx-wrapper")) setCtxMenuRow(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [ctxMenuRow]);

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
      if (key === "vatAmount" && value.trim()) {
        const vatNum = Number(value);
        if (Number.isFinite(vatNum) && vatNum > 0) {
          next.amountTotal = String(Math.round((vatNum / 0.18) * 100) / 100);
        }
      }
      return next;
    });
  }

  function patchInline(key: ManualColumnKey, value: string) {
    setInlineEdit((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "entryDate" && value && !prev.monthKey) next.monthKey = value.slice(0, 7);
      if (key === "vatAmount" && value.trim()) {
        const vatNum = Number(value);
        if (Number.isFinite(vatNum) && vatNum > 0) {
          next.amountTotal = String(Math.round((vatNum / 0.18) * 100) / 100);
        }
      }
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
      if (key === "vatAmount" && value.trim()) {
        const vatNum = Number(value);
        if (Number.isFinite(vatNum) && vatNum > 0) {
          next.amountTotal = String(Math.round((vatNum / 0.18) * 100) / 100);
        }
      }
      return next;
    });
  }

  function renderModalField(col: (typeof MANUAL_SHIPMENT_COLUMNS)[number]) {
    if (col.input === "status") {
      return (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            disabled={readOnly}
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
            style={{ flex: 1 }}
          >
            {allStatuses.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {!readOnly && (
            <button
              type="button"
              className="shp-btn"
              style={{ fontSize: "0.75rem", padding: "4px 8px" }}
              onClick={() => setShowStatusMgmt(!showStatusMgmt)}
              title="ניהול סטטוסים"
            >
              ⚙
            </button>
          )}
        </div>
      );
    }
    if (col.input === "select" && col.options) {
      return (
        <select
          disabled={readOnly}
          value={form[col.key]}
          onChange={(e) => setField(col.key, e.target.value)}
        >
          <option value="">— בחר —</option>
          {col.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    if (col.input === "textarea") {
      return (
        <textarea
          disabled={readOnly}
          rows={2}
          value={form[col.key]}
          onChange={(e) => setField(col.key, e.target.value)}
        />
      );
    }
    return (
      <input
        type={col.input === "number" ? "number" : col.input === "date" ? "date" : col.input === "month" ? "month" : "text"}
        step={col.step}
        disabled={readOnly}
        value={form[col.key]}
        list={col.autocomplete ? `msh-ac-${col.key}` : undefined}
        onChange={(e) => setField(col.key, e.target.value)}
      />
    );
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
          {allStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      );
    }
    if (col.input === "select" && col.options) {
      return (
        <select
          ref={bindRef}
          className="msh-excel-input"
          disabled={pending}
          value={value}
          onKeyDown={onKey}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— בחר —</option>
          {col.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
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
        type={col.input === "number" ? "number" : col.input === "date" ? "date" : col.input === "month" ? "month" : "text"}
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
    const resolveStatusLabel = (s: string) =>
      allStatuses.find((st) => st.value === s)?.label ?? s;
    return (
      <button
        type="button"
        className="msh-excel-cell"
        title="לחיצה כפולה לעריכה"
        onDoubleClick={() => beginInlineEdit(row, colIndex)}
      >
        {col.key === "status" ? (
          <span className={statusBadgeClass(row.status)}>{resolveStatusLabel(row.status)}</span>
        ) : col.key === "amountPaid" ? (
          <span className={`msh-pay-status ${(!row.amountPaid || row.amountPaid === 0) ? "msh-pay-status--unpaid" : "msh-pay-status--paid"}`}>
            {(!row.amountPaid || row.amountPaid === 0) ? "🔴 לא שולם" : `🟢 ${display}`}
          </span>
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
        <select
          className="msh-input"
          title="מדינה"
          value={filters.country ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}
        >
          <option value="">כל המדינות</option>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
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
          {allStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {/* ─── Multi-select: City ─── */}
        <div className="msh-multiselect">
          <span className="msh-multiselect__label">עיר:</span>
          {CITY_OPTIONS.map((c) => (
            <label key={c.value} className="msh-multiselect__item">
              <input
                type="checkbox"
                checked={filterCities.has(c.value)}
                onChange={(e) => {
                  setFilterCities((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.value);
                    else next.delete(c.value);
                    return next;
                  });
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
        {/* ─── Multi-select: Shipment Type ─── */}
        <div className="msh-multiselect">
          <span className="msh-multiselect__label">סוג משלוח:</span>
          {SHIPMENT_TYPE_OPTIONS.map((t) => (
            <label key={t.value} className="msh-multiselect__item">
              <input
                type="checkbox"
                checked={filterShipmentTypes.has(t.value)}
                onChange={(e) => {
                  setFilterShipmentTypes((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(t.value);
                    else next.delete(t.value);
                    return next;
                  });
                }}
              />
              {t.label}
            </label>
          ))}
        </div>
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
            setFilterCities(new Set());
            setFilterShipmentTypes(new Set());
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
                  checked={displayRows.length > 0 && selected.size === displayRows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(displayRows.map((r) => r.id)) : new Set())
                  }
                  aria-label="בחר הכול"
                />
              </th>
              {MANUAL_SHIPMENT_COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              <th>יתרת לקוח</th>
              <th className="msh-col-actions"></th>
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
                <td className="msh-num">—</td>
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

            {displayRows.length === 0 && !draft ? (
              <tr>
                <td colSpan={COL_COUNT} className="msh-empty">
                  אין משלוחים. לחץ על &quot;+ שורה חדשה&quot; להזנה כמו Excel, או על &quot;הוסף משלוח ידני&quot; לטופס.
                </td>
              </tr>
            ) : (
              displayRows.map((r) => {
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
                        className={[
                          col.input === "number" ? "msh-num" : "",
                          col.key === "shipmentDetails" ? "msh-clamp" : "",
                          ["shipmentNumber", "containerNumber", "orderNumber", "city", "country"].includes(col.key) ? "msh-bold" : "",
                        ].filter(Boolean).join(" ") || undefined}
                      >
                        {editing
                          ? renderEditableCell(r.id, colIndex, inlineEdit![col.key], (v) =>
                              patchInline(col.key, v),
                            )
                          : renderDisplayCell(r, colIndex)}
                      </td>
                    ))}
                    <td className="msh-num msh-bold">
                      {r.amountRemaining != null && r.amountRemaining !== 0
                        ? fmtMoney(r.amountRemaining)
                        : "₪0.00"}
                    </td>
                    <td className="msh-col-actions">
                      {editing ? (
                        <div className="msh-actions">
                          <button
                            type="button"
                            className="msh-link msh-link--ok"
                            disabled={pending}
                            onClick={() => void saveInlineRow()}
                          >
                            ✔
                          </button>
                          <button type="button" className="msh-link" onClick={cancelInline}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="msh-ctx-wrapper">
                          <button
                            type="button"
                            className="msh-ctx-trigger"
                            onClick={() => setCtxMenuRow(ctxMenuRow === r.id ? null : r.id)}
                          >
                            ⋮
                          </button>
                          {ctxMenuRow === r.id && (
                            <div className="msh-ctx-menu">
                              <button onClick={() => { openView(r); setCtxMenuRow(null); }}>
                                👁️ צפייה
                              </button>
                              <button onClick={() => { beginInlineEdit(r); setCtxMenuRow(null); }}>
                                ✏️ עריכה
                              </button>
                              <button onClick={() => { duplicateAsDraft(r); setCtxMenuRow(null); }}>
                                📋 שכפול
                              </button>
                              <button
                                className="msh-ctx-danger"
                                disabled={pending}
                                onClick={() => { onDelete(r.id); setCtxMenuRow(null); }}
                              >
                                🗑️ מחיקה
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {displayRows.length > 0 && (
            <tfoot>
              <tr>
                <td>סיכום ({displayRows.length})</td>
                {MANUAL_SHIPMENT_COLUMNS.map((col) => {
                  const v = footerCell(col.key);
                  return (
                    <td key={col.key} className={v != null ? "msh-num" : undefined}>
                      {v ?? ""}
                    </td>
                  );
                })}
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </SyncedTableScroll>

      {mode && (
        <div className="msh-modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="msh-modal msh-modal--large"
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
            <div className="msh-form msh-form--v2">
              {/* ── קבוצה 1: תאריכים ופרטי בסיס ── */}
              <div className="msh-section">
                <div className="msh-section__title">תאריכים ופרטי בסיס</div>
                <div className="msh-grid msh-grid--5">
                  {MANUAL_SHIPMENT_COLUMNS.filter((c) => c.group === "dates").map((col) => (
                    <label key={col.key}>
                      <span className="msh-field-label">{col.label}</span>
                      {renderModalField(col)}
                    </label>
                  ))}
                </div>
              </div>

              {/* ── קבוצה 2: פרטי משלוח ── */}
              <div className="msh-section">
                <div className="msh-section__title">פרטי משלוח</div>
                <div className="msh-grid msh-grid--3">
                  {MANUAL_SHIPMENT_COLUMNS.filter((c) => c.group === "shipment").map((col) => (
                    <label key={col.key} className={col.input === "textarea" ? "msh-span-2" : undefined}>
                      <span className="msh-field-label">{col.label}</span>
                      {renderModalField(col)}
                    </label>
                  ))}
                </div>
                {showStatusMgmt && (
                  <div className="msh-status-mgmt">
                    <div className="msh-status-mgmt__title">ניהול סטטוסים</div>
                    <div className="msh-status-mgmt__list">
                      {customStatuses.map((s) => (
                        <div key={s.value} className="msh-status-mgmt__item">
                          <span>{s.label} ({s.value})</span>
                          <button type="button" onClick={() => removeCustomStatus(s.value)}>✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="msh-status-mgmt__add">
                      <input
                        placeholder="קוד (אנגלית)"
                        value={newStatusValue}
                        onChange={(e) => setNewStatusValue(e.target.value)}
                      />
                      <input
                        placeholder="תצוגה (עברית)"
                        value={newStatusLabel}
                        onChange={(e) => setNewStatusLabel(e.target.value)}
                      />
                      <button type="button" className="shp-btn shp-btn--primary" onClick={addCustomStatus}>
                        הוסף
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── קבוצה 3: נתונים פיננסיים ── */}
              <div className="msh-section">
                <div className="msh-section__title">נתונים פיננסיים</div>
                <div className="msh-grid msh-grid--4">
                  {MANUAL_SHIPMENT_COLUMNS.filter((c) => c.group === "financial").map((col) => (
                    <label key={col.key}>
                      <span className="msh-field-label">{col.label}</span>
                      {renderModalField(col)}
                      {col.key === "vatAmount" && (
                        <span className="msh-hint">הזן מע״מ ← סכום רישומון יחושב אוטומטית</span>
                      )}
                    </label>
                  ))}
                </div>
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
