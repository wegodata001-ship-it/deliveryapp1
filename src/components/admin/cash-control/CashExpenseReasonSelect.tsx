"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCashExpenseTypesAction } from "@/app/admin/cash-expenses/actions";
import {
  EMPLOYEE_CASH_EXPENSE_TYPE_CODES,
  findCashExpenseTypeByLabel,
  normalizeCashExpenseTypeLabel,
  type CashExpenseTypeDto,
} from "@/lib/cash-expense-types";

export type CashExpenseReasonSelectProps = {
  value: string;
  query: string;
  onChange: (next: { reason: string; query: string }) => void;
  scope?: "full" | "employee";
  disabled?: boolean;
  reloadToken?: number;
  showPlaceholder?: boolean;
  className?: string;
  fieldLabel?: string;
  inputClassName?: string;
  labelClassName?: string;
};

export function CashExpenseReasonSelect({
  value,
  query,
  onChange,
  scope = "full",
  disabled,
  reloadToken = 0,
  showPlaceholder = false,
  className,
  fieldLabel = "סוג הוצאה",
  inputClassName = "cc-input",
  labelClassName,
}: CashExpenseReasonSelectProps) {
  const [types, setTypes] = useState<CashExpenseTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await listCashExpenseTypesAction();
    setLoading(false);
    if (res.ok) setTypes(res.types);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  const options = useMemo(() => {
    return types.filter((t) => {
      if (!t.isActive && t.code !== value) return false;
      if (scope === "employee" && t.isSystem && !EMPLOYEE_CASH_EXPENSE_TYPE_CODES.has(t.code)) {
        return false;
      }
      return true;
    });
  }, [types, scope, value]);

  const selected = options.find((t) => t.code === value);
  const inputValue = query !== "" || !value ? query : (selected?.label ?? "");
  const typed = normalizeCashExpenseTypeLabel(inputValue);
  const exact = findCashExpenseTypeByLabel(options, typed);
  const filtered = useMemo(() => {
    const key = typed.toLocaleLowerCase("he");
    if (!key) return options;
    return options.filter((t) => t.label.toLocaleLowerCase("he").includes(key));
  }, [options, typed]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function commitQuery(raw: string) {
    const next = raw;
    const match = findCashExpenseTypeByLabel(options, next);
    onChange({
      reason: match?.code ?? "",
      query: next,
    });
  }

  return (
    <div className={`ce-reason-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      <label className="adm-cash-field">
        <span className={labelClassName}>{fieldLabel}</span>
        <input
          type="text"
          className={inputClassName}
          value={inputValue}
          disabled={disabled || loading}
          placeholder={showPlaceholder ? "בחר או כתוב סוג…" : "דלק, חניה, ביטוח רכב…"}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            commitQuery(e.target.value);
            setOpen(true);
          }}
        />
      </label>
      {open && !disabled ? (
        <ul className="ce-reason-combo__list" role="listbox">
          {loading ? <li className="ce-reason-combo__empty">טוען…</li> : null}
          {!loading &&
            filtered.map((t) => (
              <li key={t.code}>
                <button
                  type="button"
                  className={`ce-reason-combo__opt${t.code === value ? " is-active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ reason: t.code, query: t.label });
                    setOpen(false);
                  }}
                >
                  {t.label}
                </button>
              </li>
            ))}
          {!loading && typed && !exact ? (
            <li>
              <button
                type="button"
                className="ce-reason-combo__opt ce-reason-combo__opt--new"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ reason: "", query: typed });
                  setOpen(false);
                }}
              >
                יצירת «{typed}»
              </button>
            </li>
          ) : null}
          {!loading && filtered.length === 0 && !typed ? (
            <li className="ce-reason-combo__empty">אין סוגים</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
