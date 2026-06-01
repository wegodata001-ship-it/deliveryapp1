"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { normalizeLookupKey } from "@/lib/intake-locations-api";

export type ErpComboboxOption = { id: string; label: string };

export type ErpCreatableComboboxProps = {
  id?: string;
  /** מזהה נבחר */
  value: string;
  /** טקסט בשדה (שם לתצוגה / חיפוש) */
  label: string;
  onChange: (id: string, label: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  variant?: "form" | "table" | "filter";
  /** אפשרות ריקה בתחילת הרשימה (סינון) */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** ערך מיוחד נוסף (למשל NONE) */
  extraEmptyOptions?: { value: string; label: string }[];
  entityName: string;
  addNewMenuLabel?: string;
  dialogTitle?: string;
  minSearchLength?: number;
  minCreateLength?: number;
  allowCreate?: boolean;
  fetchOptions: (query: string) => Promise<ErpComboboxOption[]>;
  createOption?: (name: string) => Promise<ErpComboboxOption>;
  onOptionCreated?: (option: ErpComboboxOption) => void;
};

export function ErpCreatableCombobox({
  id,
  value,
  label,
  onChange,
  disabled,
  placeholder,
  className,
  inputClassName,
  variant = "form",
  allowEmpty,
  emptyLabel = "—",
  extraEmptyOptions,
  entityName,
  addNewMenuLabel,
  dialogTitle,
  minSearchLength = 0,
  minCreateLength = 2,
  allowCreate = true,
  fetchOptions,
  createOption,
  onOptionCreated,
}: ErpCreatableComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(label);
  const [hits, setHits] = useState<ErpComboboxOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogName, setDialogName] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogErr, setDialogErr] = useState<string | null>(null);
  const searchGen = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(label);
  }, [label]);

  const loadOptions = useCallback(
    async (q: string) => {
      const gen = ++searchGen.current;
      setBusy(true);
      try {
        const rows = await fetchOptions(q);
        if (searchGen.current !== gen) return;
        setHits(rows);
      } catch {
        if (searchGen.current !== gen) return;
        setHits([]);
      } finally {
        if (searchGen.current === gen) setBusy(false);
      }
    },
    [fetchOptions],
  );

  useEffect(() => {
    void loadOptions("");
  }, [loadOptions]);

  useEffect(() => {
    const q = query.trim();
    if (!open) return;
    const t = window.setTimeout(() => void loadOptions(q), q ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [query, open, loadOptions]);

  const trimmed = query.trim();
  const canQuickAdd =
    allowCreate &&
    !!createOption &&
    trimmed.length >= minCreateLength &&
    !hits.some((h) => normalizeLookupKey(h.label) === normalizeLookupKey(trimmed));

  const listRows = useMemo(() => {
    const rows: ErpComboboxOption[] = [...hits];
    if (value && label.trim() && !rows.some((r) => r.id === value)) {
      rows.unshift({ id: value, label: label.trim() });
    }
    return rows;
  }, [hits, value, label]);

  const pick = useCallback(
    (row: ErpComboboxOption) => {
      onChange(row.id, row.label);
      setQuery(row.label);
      setOpen(false);
    },
    [onChange],
  );

  const pickEmpty = useCallback(() => {
    onChange("", "");
    setQuery("");
    setOpen(false);
  }, [onChange]);

  const openCreateDialog = useCallback((prefill?: string) => {
    setDialogName((prefill ?? trimmed).trim());
    setDialogErr(null);
    setDialogOpen(true);
    setOpen(false);
  }, [trimmed]);

  const saveDialog = useCallback(async () => {
    if (!createOption) return;
    const name = dialogName.trim();
    if (name.length < minCreateLength) {
      setDialogErr(`יש להזין לפחות ${minCreateLength} תווים`);
      return;
    }
    setDialogBusy(true);
    setDialogErr(null);
    try {
      const row = await createOption(name);
      onOptionCreated?.(row);
      pick(row);
      setDialogOpen(false);
    } catch (e) {
      setDialogErr(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setDialogBusy(false);
    }
  }, [createOption, dialogName, minCreateLength, onOptionCreated, pick]);

  const quickAdd = useCallback(async () => {
    if (!createOption || !canQuickAdd) return;
    setBusy(true);
    try {
      const row = await createOption(trimmed);
      onOptionCreated?.(row);
      pick(row);
    } catch {
      openCreateDialog(trimmed);
    } finally {
      setBusy(false);
    }
  }, [canQuickAdd, createOption, trimmed, onOptionCreated, pick, openCreateDialog]);

  const menuAddLabel = addNewMenuLabel ?? `+ הוסף ${entityName} חדש`;
  const modalTitle = dialogTitle ?? `הוסף ${entityName}`;

  const listItemCount =
    (allowEmpty ? 1 : 0) +
    (extraEmptyOptions?.length ?? 0) +
    listRows.length +
    (busy ? 1 : 0) +
    (!busy && listRows.length === 0 && trimmed.length >= minSearchLength ? 1 : 0) +
    (canQuickAdd ? 1 : 0) +
    (allowCreate && createOption ? 1 : 0);

  return (
    <>
      <div
        ref={wrapRef}
        className={[
          "adm-erp-combo",
          `adm-erp-combo--${variant}`,
          open ? "adm-erp-combo--open" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        dir="rtl"
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      >
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          className={["adm-erp-combo__input", inputClassName].filter(Boolean).join(" ")}
          value={query}
          title={label.trim() || query.trim() || undefined}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange("", e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setQuery(label);
              return;
            }
            if (e.key === "ArrowDown" && open && listItemCount > 0) {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, listItemCount - 1));
              return;
            }
            if (e.key === "ArrowUp" && open && listItemCount > 0) {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (busy) return;
            let idx = activeIdx;
            if (allowEmpty && idx === 0) {
              pickEmpty();
              return;
            }
            if (allowEmpty) idx -= 1;
            if (extraEmptyOptions?.length) {
              if (idx < extraEmptyOptions.length) {
                const opt = extraEmptyOptions[idx]!;
                onChange(opt.value, opt.label);
                setQuery(opt.label);
                setOpen(false);
                return;
              }
              idx -= extraEmptyOptions.length;
            }
            if (idx < listRows.length) {
              pick(listRows[idx]!);
              return;
            }
            idx -= listRows.length;
            if (canQuickAdd && idx === 0) {
              void quickAdd();
              return;
            }
            if (allowCreate && createOption) {
              openCreateDialog();
            }
          }}
        />
        {open ? (
          <ul id={listId} className="adm-erp-combo__list" role="listbox" aria-label={entityName}>
            {allowEmpty ? (
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  className={`adm-erp-combo__item${activeIdx === 0 ? " adm-erp-combo__item--active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={pickEmpty}
                >
                  {emptyLabel}
                </button>
              </li>
            ) : null}
            {extraEmptyOptions?.map((opt, i) => {
              const idx = (allowEmpty ? 1 : 0) + i;
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    className={`adm-erp-combo__item${activeIdx === idx ? " adm-erp-combo__item--active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(opt.value, opt.label);
                      setQuery(opt.label);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
            {busy ? <li className="adm-erp-combo__static">טוען…</li> : null}
            {!busy && listRows.length === 0 && trimmed.length >= minSearchLength ? (
              <li className="adm-erp-combo__static adm-erp-combo__empty">לא נמצאו תוצאות</li>
            ) : null}
            {!busy
              ? listRows.map((row, i) => {
                  const idx =
                    (allowEmpty ? 1 : 0) + (extraEmptyOptions?.length ?? 0) + i;
                  return (
                    <li key={row.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={value === row.id}
                        className={[
                          "adm-erp-combo__item",
                          activeIdx === idx ? "adm-erp-combo__item--active" : "",
                          value === row.id ? "adm-erp-combo__item--selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(row)}
                      >
                        {row.label}
                      </button>
                    </li>
                  );
                })
              : null}
            {canQuickAdd ? (
              <li role="presentation">
                <button
                  type="button"
                  className="adm-erp-combo__item adm-erp-combo__item--create"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void quickAdd()}
                >
                  + הוסף &quot;{trimmed}&quot;
                </button>
              </li>
            ) : null}
            {allowCreate && createOption ? (
              <li role="presentation" className="adm-erp-combo__footer">
                <button
                  type="button"
                  className="adm-erp-combo__item adm-erp-combo__item--add-new"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openCreateDialog()}
                >
                  {menuAddLabel}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <Modal open={dialogOpen} onClose={() => !dialogBusy && setDialogOpen(false)} title={modalTitle} size="sm">
        <div className="adm-erp-combo-dialog" dir="rtl">
          <label className="adm-erp-combo-dialog__label" htmlFor={`${id ?? listId}-dialog-name`}>
            {entityName}
          </label>
          <input
            id={`${id ?? listId}-dialog-name`}
            type="text"
            className="adm-erp-combo-dialog__input"
            value={dialogName}
            disabled={dialogBusy}
            autoFocus
            onChange={(e) => setDialogName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveDialog();
            }}
          />
          {dialogErr ? <p className="adm-erp-combo-dialog__err">{dialogErr}</p> : null}
          <div className="adm-erp-combo-dialog__actions">
            <button type="button" className="btn btn-primary" disabled={dialogBusy} onClick={() => void saveDialog()}>
              {dialogBusy ? "שומר…" : "שמור"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={dialogBusy}
              onClick={() => setDialogOpen(false)}
            >
              ביטול
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** חיפוש בלבד — ללא יצירה (מקור, אמצעי תשלום וכו׳) */
export function ErpSearchCombobox({
  options,
  ...rest
}: Omit<ErpCreatableComboboxProps, "fetchOptions" | "createOption" | "allowCreate"> & {
  options: ErpComboboxOption[];
}) {
  const fetchOptions = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase();
      const list = !q
        ? options
        : options.filter(
            (o) =>
              o.label.toLowerCase().includes(q) ||
              normalizeLookupKey(o.label).includes(normalizeLookupKey(q)),
          );
      return list;
    },
    [options],
  );
  return (
    <ErpCreatableCombobox
      {...rest}
      allowCreate={false}
      fetchOptions={fetchOptions}
      minSearchLength={0}
    />
  );
}
