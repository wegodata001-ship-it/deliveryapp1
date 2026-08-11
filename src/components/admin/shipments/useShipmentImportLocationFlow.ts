"use client";

import { useCallback, useState } from "react";
import type { ExcelShipmentPreviewRow } from "@/app/admin/shipments/types";
import { previewShipmentImportLocationMappingsAction } from "@/app/admin/shipments/actions";
import {
  applyImportLocationMappingsToRows,
  enrichExcelPreviewRows,
  type ShipmentImportLocationMapping,
} from "@/lib/shipment-import-preview-utils";

export function useShipmentImportLocationFlow() {
  const [pendingMappings, setPendingMappings] = useState<ShipmentImportLocationMapping[] | null>(
    null,
  );
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [mappingChecked, setMappingChecked] = useState(false);

  const resetMappingFlow = useCallback(() => {
    setPendingMappings(null);
    setMappingModalOpen(false);
    setMappingChecked(false);
  }, []);

  const loadPreviewRows = useCallback((rows: ExcelShipmentPreviewRow[]) => {
    resetMappingFlow();
    return enrichExcelPreviewRows(rows);
  }, [resetMappingFlow]);

  const checkLocationMappings = useCallback(async (rows: ExcelShipmentPreviewRow[]) => {
    setMappingChecked(true);
    const places = [
      ...new Set(
        rows
          .map((r) => r.originalDeliveryPlace?.trim() || r.city?.trim() || r.address?.trim() || "")
          .filter(Boolean),
      ),
    ];
    if (places.length === 0) return;

    const res = await previewShipmentImportLocationMappingsAction(places);
    if (res.ok && res.mappings.length > 0) {
      setPendingMappings(res.mappings);
      setMappingModalOpen(true);
    }
  }, []);

  const applyMappings = useCallback(
    (rows: ExcelShipmentPreviewRow[], setRows: (rows: ExcelShipmentPreviewRow[]) => void) => {
      if (!pendingMappings?.length) {
        setMappingModalOpen(false);
        return;
      }
      setRows(applyImportLocationMappingsToRows(rows, pendingMappings));
      setMappingModalOpen(false);
      setPendingMappings(null);
    },
    [pendingMappings],
  );

  const keepOriginalMappings = useCallback(() => {
    setMappingModalOpen(false);
    setPendingMappings(null);
  }, []);

  return {
    pendingMappings,
    mappingModalOpen,
    mappingChecked,
    loadPreviewRows,
    checkLocationMappings,
    applyMappings,
    keepOriginalMappings,
    resetMappingFlow,
  };
}
