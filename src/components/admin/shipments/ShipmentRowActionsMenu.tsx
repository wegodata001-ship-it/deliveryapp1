"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, MoreVertical, PackagePlus, Truck, Wallet } from "lucide-react";
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";

export type ShipmentRowActionsMenuProps = {
  record: ShipmentRecordDto;
  feeAmount: number;
  onFixLocation: (record: ShipmentRecordDto) => void;
  onCollect: (record: ShipmentRecordDto) => void;
  onAddPackage?: (record: ShipmentRecordDto) => void;
  onAssignZone: (record: ShipmentRecordDto) => void;
  onAssignCourier: (record: ShipmentRecordDto) => void;
};

export function ShipmentRowActionsMenu({
  record,
  feeAmount,
  onFixLocation,
  onCollect,
  onAddPackage,
  onAssignZone,
  onAssignCourier,
}: ShipmentRowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="shp-row-menu" ref={rootRef}>
      <button
        type="button"
        className="shp-row-menu__trigger"
        aria-label="פעולות"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={16} />
      </button>
      {open ? (
        <div className="shp-row-menu__panel" role="menu">
          <button type="button" role="menuitem" onClick={() => run(() => onFixLocation(record))}>
            <MapPin size={14} aria-hidden />
            שינוי מקום מסירה
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => onAssignZone(record))}>
            <MapPin size={14} aria-hidden />
            שינוי אזור
          </button>
          <button type="button" role="menuitem" onClick={() => run(() => onAssignCourier(record))}>
            <Truck size={14} aria-hidden />
            שינוי שליח
          </button>
          {feeAmount > 0 ? (
            <button type="button" role="menuitem" onClick={() => run(() => onCollect(record))}>
              <Wallet size={14} aria-hidden />
              גבייה
            </button>
          ) : null}
          {onAddPackage ? (
            <button type="button" role="menuitem" onClick={() => run(() => onAddPackage(record))}>
              <PackagePlus size={14} aria-hidden />
              הוסף חבילה
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
