"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  ORDERS_EXPORT_MENU,
  type OrdersListExportPreset,
} from "@/lib/orders-list-export-presets";

type Variant = "pdf" | "excel";

type Props = {
  variant: Variant;
  disabled?: boolean;
  onSelect: (preset: OrdersListExportPreset) => void;
};

export function OrdersListExportSplitButton({ variant, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const label = variant === "pdf" ? "PDF" : "EXCEL";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (preset: OrdersListExportPreset) => {
    setOpen(false);
    onSelect(preset);
  };

  return (
    <div
      className={`adm-export-split-wrap adm-export-split-wrap--${variant} adm-orders-kpi-export-split`}
      ref={wrapRef}
    >
      <div
        className={`adm-export-split adm-export-btn adm-export-btn--${variant} adm-orders-kpi-export-btn`}
        role="group"
        aria-label={`ייצוא ${label}`}
      >
        <span className="adm-export-split__label adm-orders-kpi-export-btn__label">{label}</span>
        <button
          type="button"
          className="adm-export-split__toggle"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`פתיחת תפריט ${label}`}
          title={`אפשרויות ${label}`}
        >
          <ChevronDown size={14} strokeWidth={2.2} className="adm-export-split__chev" aria-hidden />
        </button>
      </div>
      {open ? (
        <ul className="adm-export-menu" role="menu" dir="rtl">
          {ORDERS_EXPORT_MENU.map((entry, idx) =>
            entry.kind === "item" ? (
              <li key={entry.preset} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="adm-export-menu__btn"
                  onClick={() => pick(entry.preset)}
                >
                  {entry.label}
                </button>
              </li>
            ) : (
              <li key={`group-${idx}`} role="none" className="adm-export-menu__group">
                <span className="adm-export-menu__group-label">{entry.label}</span>
                <ul className="adm-export-menu__sub" role="group">
                  {entry.children.map((child) => (
                    <li key={child.preset} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="adm-export-menu__btn adm-export-menu__btn--sub"
                        onClick={() => pick(child.preset)}
                      >
                        {child.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
