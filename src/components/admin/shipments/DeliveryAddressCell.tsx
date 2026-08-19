"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EffectiveDeliveryAddress } from "@/lib/shipment-delivery-place";

export type DeliveryAddressCellProps = {
  address: EffectiveDeliveryAddress;
};

export function DeliveryAddressCell({ address }: DeliveryAddressCellProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

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

  if (address.display === "—") {
    return <span className="shp-delivery-addr__empty">—</span>;
  }

  return (
    <div className="shp-delivery-addr" ref={rootRef}>
      <div className="shp-delivery-addr__text" dir="auto" title={address.display}>
        {address.display}
      </div>
      {address.isPlaceUpdated ? (
        <>
          <button
            type="button"
            className="shp-delivery-addr__badge"
            aria-expanded={open}
            aria-controls={popoverId}
            onClick={() => setOpen((v) => !v)}
          >
            ✓ כתובת מעודכנת
          </button>
          {open ? (
            <div
              id={popoverId}
              className="shp-delivery-addr__popover"
              role="dialog"
              aria-label="פירוט כתובת"
            >
              <dl>
                <div>
                  <dt>כתובת מקורית</dt>
                  <dd dir="auto">{address.originalDisplay}</dd>
                </div>
                <div>
                  <dt>כתובת מעודכנת</dt>
                  <dd dir="auto">{address.updatedDisplay ?? address.place ?? address.display}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
