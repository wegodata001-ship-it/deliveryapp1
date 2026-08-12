"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  buildShipmentCountryContext,
  type ShipmentCountryContext,
} from "@/lib/shipment-country-scope.shared";
import type { WorkCountryCode } from "@/lib/work-country";

const ShipmentCountryCtx = createContext<ShipmentCountryContext | null>(null);

export function ShipmentCountryProvider({
  workCountry,
  children,
}: {
  workCountry: WorkCountryCode;
  children: ReactNode;
}) {
  const value = useMemo(() => buildShipmentCountryContext(workCountry), [workCountry]);
  return <ShipmentCountryCtx.Provider value={value}>{children}</ShipmentCountryCtx.Provider>;
}

export function useShipmentCountry(): ShipmentCountryContext {
  const ctx = useContext(ShipmentCountryCtx);
  if (!ctx) {
    throw new Error("useShipmentCountry must be used within ShipmentCountryProvider");
  }
  return ctx;
}

export function useShipmentCountryOptional(): ShipmentCountryContext | null {
  return useContext(ShipmentCountryCtx);
}
