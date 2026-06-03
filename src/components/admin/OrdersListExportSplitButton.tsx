"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import {
  ordersExportMenuForVariant,
  type OrdersListExportPreset,
} from "@/lib/orders-list-export-presets";

type Variant = "pdf" | "excel";

type MenuCoords = {
  top: number;
  right: number;
  minWidth: number;
  flipUp: boolean;
};

type Props = {
  variant: Variant;
  disabled?: boolean;
  onQuickExport: () => void;
  onSelect: (preset: OrdersListExportPreset) => void;
};

const MENU_GAP_PX = 8;
const MENU_MIN_WIDTH = 260;
const MENU_FALLBACK_HEIGHT = 280;

export function OrdersListExportSplitButton({
  variant,
  disabled,
  onQuickExport,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<MenuCoords | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = `adm-export-menu-${variant}`;
  const label = variant === "pdf" ? "PDF" : "EXCEL";

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuCoords(null);
  }, []);

  const updateMenuPosition = useCallback(() => {
    const anchor = wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? MENU_FALLBACK_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP_PX;
    const flipUp = spaceBelow < menuHeight && rect.top > spaceBelow;
    const top = flipUp
      ? Math.max(MENU_GAP_PX, rect.top - MENU_GAP_PX - menuHeight)
      : rect.bottom + MENU_GAP_PX;
    setMenuCoords({
      top,
      right: Math.max(MENU_GAP_PX, window.innerWidth - rect.right),
      minWidth: MENU_MIN_WIDTH,
      flipUp,
    });
  }, []);

  const seedMenuCoords = useCallback(() => {
    const anchor = wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuCoords({
      top: rect.bottom + MENU_GAP_PX,
      right: Math.max(MENU_GAP_PX, window.innerWidth - rect.right),
      minWidth: MENU_MIN_WIDTH,
      flipUp: false,
    });
  }, []);

  const toggleMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (open) {
        closeMenu();
        return;
      }
      seedMenuCoords();
      setOpen(true);
    },
    [closeMenu, disabled, open, seedMenuCoords],
  );

  const onMainClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      closeMenu();
      onQuickExport();
    },
    [closeMenu, disabled, onQuickExport],
  );

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => updateMenuPosition());
  }, [open, updateMenuPosition, variant]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (document.getElementById(menuId)?.contains(t)) return;
      closeMenu();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("click", onDoc, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("click", onDoc, true);
    };
  }, [closeMenu, menuId, open]);

  const pick = (preset: OrdersListExportPreset) => {
    closeMenu();
    onSelect(preset);
  };

  const menuEntries = ordersExportMenuForVariant(variant);

  const floatingMenu =
    open && menuCoords && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={menuRef}
            id={menuId}
            className={[
              "adm-export-menu",
              "adm-export-menu--floating",
              menuCoords.flipUp ? "adm-export-menu--flip-up" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="menu"
            dir="rtl"
            style={{
              position: "fixed",
              top: menuCoords.top,
              right: menuCoords.right,
              minWidth: menuCoords.minWidth,
              zIndex: 99999,
            }}
          >
            {menuEntries.map((entry, idx) =>
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
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={[
        "adm-export-split-wrap",
        `adm-export-split-wrap--${variant}`,
        "adm-orders-kpi-export-split",
        open ? "adm-export-split-wrap--open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={wrapRef}
      data-export-open={open ? "true" : "false"}
    >
      <div
        className={`adm-export-split adm-export-btn adm-export-btn--${variant} adm-orders-kpi-export-btn`}
        role="group"
        aria-label={`ייצוא ${label}`}
      >
        <button
          type="button"
          className="adm-export-split__main"
          disabled={disabled}
          onClick={onMainClick}
          title={`ייצוא ${label} לפי הסינון הנוכחי`}
          aria-label={`ייצוא ${label} לפי הסינון הנוכחי`}
        >
          <span className="adm-export-split__label adm-orders-kpi-export-btn__label">{label}</span>
        </button>
        <button
          type="button"
          className="adm-export-split__toggle"
          disabled={disabled}
          onClick={toggleMenu}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`אפשרויות ${label}`}
          title={`אפשרויות ${label}`}
        >
          <ChevronDown
            size={14}
            strokeWidth={2.2}
            className={["adm-export-split__chev", open ? "adm-export-split__chev--open" : ""]
              .filter(Boolean)
              .join(" ")}
            aria-hidden
          />
        </button>
      </div>
      {floatingMenu}
    </div>
  );
}
