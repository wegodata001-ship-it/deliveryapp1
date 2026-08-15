"use client";

import { useCallback, useState } from "react";
import type { ExcelShipmentPreviewRow } from "@/app/admin/shipments/types";
import { previewShipmentImportLocationMappingsAction } from "@/app/admin/shipments/actions";
import type { WorkCountryCode } from "@/lib/work-country";
import {
  applyImportLocationMappingsToRows,
  enrichExcelPreviewRows,
  normalizeImportLocationMappings,
  restoreImportMappingToSuggested,
  updateImportMappingOverride,
  type ShipmentImportLocationMapping,
} from "@/lib/shipment-import-preview-utils";

export function useShipmentImportLocationFlow(workCountry: WorkCountryCode) {
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

    const res = await previewShipmentImportLocationMappingsAction(workCountry, places);
    if (res.ok && res.mappings.length > 0) {
      setPendingMappings(normalizeImportLocationMappings(res.mappings));
      setMappingModalOpen(true);
    }
  }, [workCountry]);

  const setMappings = useCallback((mappings: ShipmentImportLocationMapping[]) => {
    setPendingMappings(normalizeImportLocationMappings(mappings));
  }, []);

  const patchMappingOverride = useCallback(
    (
      originalPlace: string,
      patch: { updatedPlace?: string; zoneId?: string | null; zoneName?: string | null },
    ) => {
      setPendingMappings((prev) =>
        prev ? updateImportMappingOverride(prev, originalPlace, patch) : prev,
      );
    },
    [],
  );

  const restoreMappingOverride = useCallback((originalPlace: string) => {
    setPendingMappings((prev) =>
      prev
        ? prev.map((m) =>
            m.originalPlace.trim() === originalPlace.trim()
              ? restoreImportMappingToSuggested(m)
              : m,
          )
        : prev,
    );
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
    setMappings,
    patchMappingOverride,
    restoreMappingOverride,
    applyMappings,
    keepOriginalMappings,
    resetMappingFlow,
  };
}
