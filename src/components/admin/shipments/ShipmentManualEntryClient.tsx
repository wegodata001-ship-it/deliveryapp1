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
import { ManualShipmentInlineCell } from "@/components/admin/shipments/ManualShipmentInlineCell";
import { ManualShipmentPaymentCell } from "@/components/admin/shipments/ManualShipmentPaymentCell";
import { ManualShipmentPaymentDetailModal } from "@/components/admin/shipments/ManualShipmentPaymentDetailModal";
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
  MANUAL_SHIPMENT_TABLE_COLUMNS,
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
import {
  manualShipmentPaymentFromRow,
} from "@/lib/manual-shipment-payment";
import { useShipmentCountry } from "@/components/admin/shipments/ShipmentCountryProvider";
import { ShipmentConfirmModal } from "@/components/admin/shipments/ShipmentConfirmModal";

type Mode = "create" | "edit" | "view" | null;
type FormState = Record<ManualColumnKey, string>;
type EditTarget = { rowId: string; colIndex: number } | null;
type EditingCell = { rowId: string; colKey: ManualColumnKey } | null;
type CellFeedback = "saving" | "saved" | "error";

const DRAFT_ID = "__draft__";
const TABLE_COL_KEYS = MANUAL_SHIPMENT_TABLE_COLUMNS.map((c) => c.key);
const COL_KEYS = MANUAL_SHIPMENT_COLUMNS.map((c) => c.key);
const COL_COUNT = MANUAL_SHIPMENT_TABLE_COLUMNS.length + 2;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function draftInputType(col: (typeof MANUAL_SHIPMENT_COLUMNS)[number]): {
  type: string;
  inputMode?: "decimal" | "text";
} {
  if (col.input === "number") return { type: "text", inputMode: "decimal" };
  if (col.input === "date") return { type: "date" };
  if (col.input === "month") return { type: "month" };
  return { type: "text" };
}

function syncMonthKeyFromEntryDate(entryDate: string, prevMonthKey: string): string {
  if (!ISO_DATE_RE.test(entryDate)) return prevMonthKey;
  if (prevMonthKey.trim()) return prevMonthKey;
  return entryDate.slice(0, 7);
}

const NUM_KEYS: Set<ManualColumnKey> = new Set([
  "vatAmount",
  "amountTotal",
  "paymentAmount",
  "inlandHaulage",
  "portHaulage",
]);

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
    paymentAmount: row.paymentAmount != null ? String(row.paymentAmount) : "",
    amountPaid: "",
    makasa: row.makasa ?? "",
    makasaNumber: row.makasaNumber ?? "",
    inlandHaulage: row.inlandHaulage != null ? String(row.inlandHaulage) : "",
    portHaulage: row.portHaulage != null ? String(row.portHaulage) : "",
  };
}

function formToInput(f: FormState): ManualShipmentInput {
  const n = (v: string) => {
    const t = v.trim().replace(/,/g, "");
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
    paymentAmount: n(f.paymentAmount),
    makasa: f.makasa.trim() ? f.makasa.trim() : null,
    makasaNumber: f.makasaNumber || null,
    inlandHaulage: n(f.inlandHaulage),
    portHaulage: n(f.portHaulage),
  };
}

function fieldToPartialInput(key: ManualColumnKey, value: string): ManualShipmentInput {
  if (key === "amountPaid") return {};
  const n = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    if (!t) return null;
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
  };
  if (NUM_KEYS.has(key)) return { [key]: n(value) };
  if (key === "makasa") return { makasa: value.trim() ? value.trim() : null };
  if (key === "status") return { status: value || "NEW" };
  return { [key]: value || null };
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

function syncComputedPayment(row: ManualShipmentDto): ManualShipmentDto {
  return {
    ...row,
    amountPaid: manualShipmentPaymentFromRow(row).payment,
  };
}

function fmtDisplayDate(iso: string): string {
  if (!iso.trim()) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtDisplayMonth(ym: string): string {
  if (!ym.trim()) return "—";
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${m}/${y}`;
}

function formatCellDisplay(
  col: (typeof MANUAL_SHIPMENT_COLUMNS)[number],
  value: string,
  statuses: { value: string; label: string }[],
): string {
  if (!value.trim()) return "—";
  if (col.input === "date") return fmtDisplayDate(value);
  if (col.input === "month") return fmtDisplayMonth(value);
  if (col.input === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? fmtMoney(n) : value;
  }
  if (col.input === "status") {
    return statuses.find((s) => s.value === value)?.label ?? statusLabel(value);
  }
  if (col.input === "select" && col.options) {
    return col.options.find((o) => o.value === value)?.label ?? value;
  }
  return value;
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
    case "NEW": return "msh-status msh-status--new";
    case "IN_TRANSIT": return "msh-status msh-status--transit";
    case "ARRIVED": return "msh-status msh-status--arrived";
    case "IN_DISTRIBUTION": return "msh-status msh-status--dist";
    case "COMPLETED": return "msh-status msh-status--done";
    case "CANCELLED": return "msh-status msh-status--cancel";
    default: return "msh-status";
  }
}

function statusRowClass(status: string): string {
  switch (status) {
    case "NEW": return "msh-row--new";
    case "IN_TRANSIT": return "msh-row--transit";
    case "ARRIVED": return "msh-row--arrived";
    case "IN_DISTRIBUTION": return "msh-row--dist";
    case "COMPLETED": return "msh-row--done";
    case "CANCELLED": return "msh-row--cancel";
    default: return "";
  }
}

type Props = { initialRows: ManualShipmentDto[] };

export function ShipmentManualEntryClient({ initialRows }: Props) {
  const { workCountry } = useShipmentCountry();
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState<ManualShipmentFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteOneId, setDeleteOneId] = useState<string | null>(null);
  const [deleteOneError, setDeleteOneError] = useState<string | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteSelectedError, setDeleteSelectedError] = useState<string | null>(null);

  const [draft, setDraft] = useState<FormState | null>(null);
  const [focusCell, setFocusCell] = useState<EditTarget>(null);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [keepShipmentNumber, setKeepShipmentNumber] = useState(true);
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>>(
    new Map(),
  );

  // per-cell feedback: "rowId:colKey" → feedback state
  const [cellFeedback, setCellFeedback] = useState<Map<string, CellFeedback>>(new Map());
  const [cellErrors, setCellErrors] = useState<Map<string, string>>(new Map());
  const feedbackTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // track original DB values so ESC can revert
  const originalValues = useRef<Map<string, FormState>>(new Map());

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
  const [paymentDetailRow, setPaymentDetailRow] = useState<ManualShipmentDto | null>(null);

  // ─── Multi-select filters ───
  const [filterCities, setFilterCities] = useState<Set<string>>(new Set());
  const [filterShipmentTypes, setFilterShipmentTypes] = useState<Set<string>>(new Set());

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

  const totals = useMemo(() => {
    return displayRows.reduce(
      (acc, r) => {
        const payment = manualShipmentPaymentFromRow(r);
        acc.amountTotal += r.amountTotal ?? 0;
        acc.paymentAmount += r.paymentAmount ?? 0;
        acc.amountPaid += payment.payment;
        acc.vatAmount += r.vatAmount ?? 0;
        acc.makasa += payment.makasaAmount;
        return acc;
      },
      { amountTotal: 0, paymentAmount: 0, amountPaid: 0, vatAmount: 0, makasa: 0 },
    );
  }, [displayRows]);

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

  // keep original values in sync with rows
  useEffect(() => {
    for (const r of rows) {
      originalValues.current.set(r.id, dtoToForm(r));
    }
  }, [rows]);

  const refresh = useCallback(
    (f: ManualShipmentFilters = filters) => {
      startTransition(async () => {
        const res = await listManualShipmentsAction(workCountry, f);
        if (res.ok) {
          setRows(res.rows);
          setSelected(new Set());
        } else {
          setError(res.error);
        }
      });
    },
    [filters, workCountry],
  );

  useEffect(() => {
    const target =
      focusCell ??
      (editingCell
        ? { rowId: editingCell.rowId, colIndex: TABLE_COL_KEYS.indexOf(editingCell.colKey) }
        : null);
    if (!target || target.colIndex < 0) return;
    const key = `${target.rowId}:${target.colIndex}`;
    const el = inputRefs.current.get(key);
    if (!el || document.activeElement === el) return;
    el.focus();
    if ("select" in el && typeof el.select === "function" && el.tagName !== "SELECT") {
      try { el.select(); } catch { /* ignore */ }
    }
  }, [focusCell, editingCell]);

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

  function cellFbKey(rowId: string, key: ManualColumnKey) {
    return `${rowId}:${key}`;
  }

  function setCellFb(rowId: string, key: ManualColumnKey, fb: CellFeedback | null) {
    const k = cellFbKey(rowId, key);
    const prev = feedbackTimers.current.get(k);
    if (prev) clearTimeout(prev);

    if (fb === null) {
      setCellFeedback((m) => { const next = new Map(m); next.delete(k); return next; });
      setCellErrors((m) => { const next = new Map(m); next.delete(k); return next; });
      return;
    }
    setCellFeedback((m) => new Map(m).set(k, fb));
    if (fb === "saved") {
      const timer = setTimeout(() => {
        setCellFeedback((m) => { const next = new Map(m); next.delete(k); return next; });
        feedbackTimers.current.delete(k);
      }, 1200);
      feedbackTimers.current.set(k, timer);
    }
  }

  function setCellErr(rowId: string, key: ManualColumnKey, msg: string | null) {
    const k = cellFbKey(rowId, key);
    if (msg) setCellErrors((m) => new Map(m).set(k, msg));
    else setCellErrors((m) => { const next = new Map(m); next.delete(k); return next; });
  }

  // ─── Auto-save a single field for an existing row ───
  async function saveField(rowId: string, key: ManualColumnKey, newValue: string): Promise<boolean> {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return false;
    const origForm = originalValues.current.get(rowId);
    const origValue = origForm ? origForm[key] : "";
    if (newValue === origValue) return true;

    let input = fieldToPartialInput(key, newValue);

    // VAT auto-calc: also send amountTotal when vatAmount changes
    if (key === "vatAmount" && newValue.trim()) {
      const vatNum = Number(newValue);
      if (Number.isFinite(vatNum) && vatNum > 0) {
        const computed = Math.round((vatNum / 0.18) * 100) / 100;
        input = { ...input, amountTotal: computed };
      }
    }
    // entryDate → monthKey auto-fill
    if (key === "entryDate" && newValue) {
      const origMonth = origForm?.monthKey ?? "";
      if (!origMonth) {
        input = { ...input, monthKey: newValue.slice(0, 7) };
      }
    }

    setCellFb(rowId, key, "saving");
    setCellErr(rowId, key, null);

    const res = await updateManualShipmentAction(workCountry, rowId, input);
    if (!res.ok) {
      setCellFb(rowId, key, "error");
      setCellErr(rowId, key, res.error);
      // revert local value
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== rowId) return r;
          const reverted = { ...r };
          if (origForm) {
            for (const [k, v] of Object.entries(fieldToPartialInput(key, origValue))) {
              (reverted as Record<string, unknown>)[k] = v;
            }
          }
          return reverted;
        }) as ManualShipmentDto[],
      );
      return false;
    }

    setCellFb(rowId, key, "saved");
    // update originals to new value
    if (origForm) {
      const updated = { ...origForm, [key]: newValue };
      if (key === "vatAmount" && newValue.trim()) {
        const vatNum = Number(newValue);
        if (Number.isFinite(vatNum) && vatNum > 0) {
          updated.amountTotal = String(Math.round((vatNum / 0.18) * 100) / 100);
        }
      }
      if (key === "entryDate" && newValue && !origForm.monthKey) {
        updated.monthKey = newValue.slice(0, 7);
      }
      originalValues.current.set(rowId, updated);
    }
    // also update amountTotal feedback if vatAmount was changed
    if (key === "vatAmount") {
      setCellFb(rowId, "amountTotal", "saved");
    }
    return true;
  }

  function exitSingleCellEdit() {
    setEditingCell(null);
    setFocusCell(null);
  }

  function startCellEdit(rowId: string, key: ManualColumnKey, colIndex: number) {
    setEditingRowId(null);
    setEditingCell({ rowId, colKey: key });
    setFocusCell({ rowId, colIndex });
  }

  function startRowEdit(rowId: string) {
    setEditingCell(null);
    setFocusCell(null);
    setEditingRowId((prev) => (prev === rowId ? null : rowId));
    setCtxMenuRow(null);
  }

  function cancelCellEdit(rowId: string, key: ManualColumnKey) {
    const origForm = originalValues.current.get(rowId);
    if (origForm) patchRowLocal(rowId, key, origForm[key]);
    if (editingRowId !== rowId) exitSingleCellEdit();
  }

  async function commitCell(rowId: string, key: ManualColumnKey, newValue: string) {
    const inRowEdit = editingRowId === rowId;
    const origForm = originalValues.current.get(rowId);
    const origValue = origForm ? origForm[key] : "";
    if (newValue === origValue) {
      if (!inRowEdit) exitSingleCellEdit();
      return;
    }
    patchRowLocal(rowId, key, newValue);
    const ok = await saveField(rowId, key, newValue);
    if (ok && !inRowEdit) exitSingleCellEdit();
  }

  // ─── Update local row state immediately (optimistic) ───
  function patchRowLocal(rowId: string, key: ManualColumnKey, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r };
        if (NUM_KEYS.has(key)) {
          const n = value.trim() ? Number(value) : null;
          (updated as Record<string, unknown>)[key] = Number.isFinite(n) ? n : null;
        } else if (key === "makasa") {
          updated.makasa = value.trim() || null;
        } else if (key === "status") {
          updated.status = value || "NEW";
        } else {
          (updated as Record<string, unknown>)[key] = value || null;
        }
        // VAT auto-calc
        if (key === "vatAmount" && value.trim()) {
          const vatNum = Number(value);
          if (Number.isFinite(vatNum) && vatNum > 0) {
            updated.amountTotal = Math.round((vatNum / 0.18) * 100) / 100;
          }
        }
        // entryDate → monthKey
        if (key === "entryDate" && value) {
          const origForm = originalValues.current.get(rowId);
          if (!origForm?.monthKey) {
            updated.monthKey = value.slice(0, 7);
          }
        }
        return syncComputedPayment(updated);
      }) as ManualShipmentDto[],
    );
  }

  function moveFocusDraft(colIndex: number, delta: number) {
    let next = colIndex + delta;
    if (next < 0) next = 0;
    if (next >= TABLE_COL_KEYS.length) {
      void saveDraft();
      return;
    }
    setFocusCell({ rowId: DRAFT_ID, colIndex: next });
  }

  function startNewRow() {
    if (draft) {
      setFocusCell({ rowId: DRAFT_ID, colIndex: 0 });
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
    const res = await createManualShipmentAction(workCountry, input);
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

  function patchDraft(key: ManualColumnKey, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "entryDate") {
        next.monthKey = syncMonthKeyFromEntryDate(value, prev.monthKey);
      }
      if (key === "vatAmount" && value.trim()) {
        const vatNum = Number(value.replace(/,/g, ""));
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
    const base = dtoToForm(row);
    for (const key of CLEAR_ON_DUPLICATE_KEYS) {
      base[key] = "";
    }
    setDraft(base);
    setFocusCell({ rowId: DRAFT_ID, colIndex: COL_KEYS.indexOf("shipmentNumber") });
    setError(null);
  }

  function onDraftKeyDown(e: ReactKeyboardEvent, colIndex: number) {
    if (e.key === "Escape") { e.preventDefault(); cancelDraft(); return; }
    if (e.key === "Tab") { e.preventDefault(); moveFocusDraft(colIndex, e.shiftKey ? -1 : 1); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); moveFocusDraft(colIndex, 1); return; }
  }

  // ─── Key handler for existing-row cells (draft row uses onDraftKeyDown) ───

  function openCreate() {
    setForm(formWithDefaults());
    setEditId(null);
    setMode("create");
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
      if (key === "entryDate") {
        next.monthKey = syncMonthKeyFromEntryDate(value, prev.monthKey);
      }
      if (key === "vatAmount" && value.trim()) {
        const vatNum = Number(value.replace(/,/g, ""));
        if (Number.isFinite(vatNum) && vatNum > 0) {
          next.amountTotal = String(Math.round((vatNum / 0.18) * 100) / 100);
        }
      }
      return next;
    });
  }

  function renderModalField(col: (typeof MANUAL_SHIPMENT_COLUMNS)[number]) {
    if (col.input === "calculated") {
      return (
        <div className="msh-payment-cell msh-payment-cell--modal">
          <ManualShipmentPaymentCell row={{
            paymentAmount: form.paymentAmount.trim() ? Number(form.paymentAmount) : null,
            amountTotal: form.amountTotal.trim() ? Number(form.amountTotal) : null,
            makasa: form.makasa,
          }} />
        </div>
      );
    }
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
        type={col.input === "number" ? "text" : col.input === "date" ? "date" : col.input === "month" ? "month" : "text"}
        inputMode={col.input === "number" ? "decimal" : undefined}
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
        const res = await createManualShipmentAction(workCountry, input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        saveSessionDefaults(form);
      } else if (mode === "edit" && editId) {
        const res = await updateManualShipmentAction(workCountry, editId, input);
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

  function openDeleteOne(id: string) {
    setDeleteOneError(null);
    setDeleteOneId(id);
  }

  function confirmDeleteOne() {
    if (!deleteOneId) return;
    startTransition(async () => {
      setDeleteOneError(null);
      const res = await deleteManualShipmentAction(workCountry, deleteOneId);
      if (!res.ok) {
        setDeleteOneError(res.error);
        return;
      }
      setDeleteOneId(null);
      refresh();
    });
  }

  function openDeleteSelected() {
    if (!selected.size) return;
    setDeleteSelectedError(null);
    setDeleteSelectedOpen(true);
  }

  function confirmDeleteSelected() {
    if (!selected.size) return;
    startTransition(async () => {
      setDeleteSelectedError(null);
      const res = await deleteManualShipmentsAction(workCountry, [...selected]);
      if (!res.ok) {
        setDeleteSelectedError(res.error);
        return;
      }
      setDeleteSelectedOpen(false);
      refresh();
    });
  }

  // ─── View / click-to-edit cell for an existing row ───
  function renderInlineCell(row: ManualShipmentDto, colIndex: number) {
    const col = MANUAL_SHIPMENT_TABLE_COLUMNS[colIndex]!;
    const key = col.key;

    if (col.input === "calculated") {
      return (
        <ManualShipmentPaymentCell
          row={row}
          onOpenDetail={() => setPaymentDetailRow(row)}
        />
      );
    }

    const formVal = dtoToForm(row);
    const value = formVal[key];
    const listId = col.autocomplete ? `msh-ac-${key}` : undefined;
    const fbKey = cellFbKey(row.id, key);
    const fb = cellFeedback.get(fbKey);
    const errMsg = cellErrors.get(fbKey);
    const isEditing =
      editingRowId === row.id ||
      (editingCell?.rowId === row.id && editingCell.colKey === key);
    const displayText = formatCellDisplay(col, value, allStatuses);
    const isEmpty = !value.trim();

    return (
      <ManualShipmentInlineCell
        col={col}
        value={value}
        isEditing={isEditing}
        displayText={displayText}
        isEmpty={isEmpty}
        allStatuses={allStatuses}
        feedback={fb}
        errorMsg={errMsg}
        listId={listId}
        statusClassName={statusBadgeClass(value || "NEW")}
        onStartEdit={() => startCellEdit(row.id, key, colIndex)}
        onCancel={() => cancelCellEdit(row.id, key)}
        onCommit={(v) => void commitCell(row.id, key, v)}
        bindRef={(el) => setInputRef(row.id, colIndex, el)}
      />
    );
  }

  // ─── Render editable cell for draft row ───
  function renderDraftCell(colIndex: number, value: string, onChange: (v: string) => void, draftForm: FormState) {
    const col = MANUAL_SHIPMENT_TABLE_COLUMNS[colIndex]!;

    if (col.input === "calculated") {
      return (
        <ManualShipmentPaymentCell
          row={{
            paymentAmount: draftForm.paymentAmount.trim() ? Number(draftForm.paymentAmount.replace(/,/g, "")) : null,
            amountTotal: draftForm.amountTotal.trim() ? Number(draftForm.amountTotal.replace(/,/g, "")) : null,
            makasa: draftForm.makasa,
          }}
        />
      );
    }

    const listId = col.autocomplete ? `msh-ac-${col.key}` : undefined;
    const bindRef = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) =>
      setInputRef(DRAFT_ID, colIndex, el);
    const onKey = (e: ReactKeyboardEvent) => onDraftKeyDown(e, colIndex);

    if (col.input === "status") {
      return (
        <select ref={bindRef} className="msh-excel-input" value={value || "NEW"} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)}>
          {allStatuses.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
        </select>
      );
    }
    if (col.input === "select" && col.options) {
      return (
        <select ref={bindRef} className="msh-excel-input" value={value} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {col.options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      );
    }
    if (col.input === "textarea") {
      return (
        <textarea ref={bindRef} className="msh-excel-input" rows={1} value={value} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />
      );
    }
    const { type, inputMode } = draftInputType(col);
    return (
      <input
        ref={bindRef}
        className="msh-excel-input"
        type={type}
        inputMode={inputMode}
        step={col.step}
        value={value}
        list={listId}
        onKeyDown={onKey}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const readOnly = mode === "view";

  function footerCell(key: ManualColumnKey): string | null {
    if (key === "amountTotal") return fmtMoney(totals.amountTotal);
    if (key === "paymentAmount") return fmtMoney(totals.paymentAmount);
    if (key === "amountPaid") return fmtMoney(totals.amountPaid);
    if (key === "vatAmount") return fmtMoney(totals.vatAmount);
    if (key === "makasa") return fmtMoney(totals.makasa);
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
            <option key={s.value} value={s.value}>{s.label}</option>
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
          onClick={openDeleteSelected}
          disabled={!selected.size || pending}
        >
          מחק מסומנים ({selected.size})
        </button>
      </div>

      {error && <div className="msh-error">{error}</div>}

      {draft && (
        <div className="msh-excel-hint">
          שורה חדשה פתוחה · Tab / Enter למעבר · Esc לביטול
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
              {MANUAL_SHIPMENT_TABLE_COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              <th className="msh-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {draft && (
              <tr className="msh-row--draft" key="new-manual-shipment">
                <td />
                {MANUAL_SHIPMENT_TABLE_COLUMNS.map((col, colIndex) => (
                  <td key={col.key}>
                    {renderDraftCell(colIndex, draft[col.key], (v) => patchDraft(col.key, v), draft)}
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

            {displayRows.length === 0 && !draft ? (
              <tr>
                <td colSpan={COL_COUNT} className="msh-empty">
                  אין משלוחים. לחץ על &quot;+ שורה חדשה&quot; להזנה כמו Excel, או על &quot;הוסף משלוח ידני&quot; לטופס.
                </td>
              </tr>
            ) : (
              displayRows.map((r) => (
                <tr
                  key={r.id}
                  className={[
                    statusRowClass(r.status),
                    editingRowId === r.id ? "msh-row--editing" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
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
                  {MANUAL_SHIPMENT_TABLE_COLUMNS.map((col, colIndex) => (
                    <td
                      key={col.key}
                      className={[
                        col.input === "number" || col.input === "calculated" ? "msh-num" : "",
                        col.key === "shipmentDetails" ? "msh-clamp" : "",
                        ["shipmentNumber", "containerNumber", "orderNumber", "city", "country"].includes(col.key) ? "msh-bold" : "",
                      ].filter(Boolean).join(" ") || undefined}
                    >
                      {renderInlineCell(r, colIndex)}
                    </td>
                  ))}
                  <td className="msh-col-actions">
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
                          <button onClick={() => { setPaymentDetailRow(r); setCtxMenuRow(null); }}>
                            📊 צפה בפירוט
                          </button>
                          <button onClick={() => { openView(r); setCtxMenuRow(null); }}>
                            👁️ צפייה
                          </button>
                          <button onClick={() => startRowEdit(r.id)}>
                            {editingRowId === r.id ? "✔ סיום עריכת שורה" : "✏️ עריכת שורה"}
                          </button>
                          <button onClick={() => { duplicateAsDraft(r); setCtxMenuRow(null); }}>
                            📋 שכפול
                          </button>
                          <button
                            className="msh-ctx-danger"
                            disabled={pending}
                            onClick={() => { openDeleteOne(r.id); setCtxMenuRow(null); }}
                          >
                            🗑️ מחיקה
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {displayRows.length > 0 && (
            <tfoot>
              <tr>
                <td>סיכום ({displayRows.length})</td>
                {MANUAL_SHIPMENT_TABLE_COLUMNS.map((col) => {
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
                        <span className="msh-hint">הזן מע״מ ← סכום רידומין יחושב אוטומטית</span>
                      )}
                      {col.key === "amountPaid" && (
                        <span className="msh-hint">מחושב: סכום התשלום − רידומין + 18% ממקאסה</span>
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

      <ManualShipmentPaymentDetailModal
        open={paymentDetailRow != null}
        row={paymentDetailRow}
        onClose={() => setPaymentDetailRow(null)}
        onEdit={(row) => {
          setPaymentDetailRow(null);
          setForm(dtoToForm(row));
          setEditId(row.id);
          setMode("edit");
          setError(null);
        }}
      />

      <ShipmentConfirmModal
        open={deleteOneId != null}
        title="מחיקת משלוח ידני"
        icon="trash"
        variant="danger"
        message="האם למחוק את המשלוח הידני?"
        confirmLabel="מחק משלוח"
        confirmBusyLabel="מוחק…"
        busy={pending}
        error={deleteOneError}
        onCancel={() => {
          if (!pending) {
            setDeleteOneId(null);
            setDeleteOneError(null);
          }
        }}
        onConfirm={confirmDeleteOne}
      />

      <ShipmentConfirmModal
        open={deleteSelectedOpen}
        title="מחיקת רשומות"
        icon="trash"
        variant="danger"
        message={
          <>
            האם למחוק <strong>{selected.size}</strong> רשומות מסומנות?
          </>
        }
        confirmLabel={selected.size === 1 ? "מחק רשומה" : `מחק ${selected.size} רשומות`}
        confirmBusyLabel="מוחק…"
        busy={pending}
        error={deleteSelectedError}
        onCancel={() => {
          if (!pending) {
            setDeleteSelectedOpen(false);
            setDeleteSelectedError(null);
          }
        }}
        onConfirm={confirmDeleteSelected}
      />
    </div>
  );
}
