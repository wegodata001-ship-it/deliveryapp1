import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyImportLocationMappingsToRows,
  enrichExcelPreviewRows,
  isImportMappingManuallyEdited,
  normalizeImportLocationMappings,
  restoreImportMappingToSuggested,
  updateImportMappingOverride,
} from "@/lib/shipment-import-preview-utils";
import type { ExcelShipmentPreviewRow } from "@/app/admin/shipments/types";

function baseRow(city: string, rowIndex = 2): ExcelShipmentPreviewRow {
  return {
    rowIndex,
    customerCode: null,
    customerName: "x",
    customerPhone: null,
    customerPhone2: null,
    address: null,
    city,
    cartonDetails: null,
    boxes: 1,
    weight: null,
    orderAmount: null,
    orderCurrency: null,
    orderAmountRaw: null,
    notes: null,
    valid: true,
    error: null,
  };
}

const NAHAF_MAPPING = {
  originalPlace: "Nahaf",
  updatedPlace: "נחף",
  deliveryLocationId: "loc-nahaf",
  zoneId: "zone-19",
  zoneName: "צפון 19",
};

describe("shipment-import-location-mapping preview rows", () => {
  it("keeps original Excel place on first load", () => {
    const rows = enrichExcelPreviewRows([baseRow("الناصرة")]);
    assert.equal(rows[0].originalDeliveryPlace, "الناصرة");
    assert.equal(rows[0].city, "الناصرة");
    assert.equal(rows[0].resolvedDeliveryPlace, undefined);
  });

  it("Test 1 — applies suggested mapping without manual edit", () => {
    const base = enrichExcelPreviewRows([baseRow("Nahaf")]);
    const updated = applyImportLocationMappingsToRows(base, [NAHAF_MAPPING]);

    assert.equal(updated[0].originalDeliveryPlace, "Nahaf");
    assert.equal(updated[0].city, "נחף");
    assert.equal(updated[0].resolvedDeliveryPlace, "נחף");
    assert.equal(updated[0].zoneId, "zone-19");
    assert.equal(updated[0].zoneName, "צפון 19");
    assert.equal(updated[0].deliveryLocationId, "loc-nahaf");
    assert.equal(updated[0].locationMatchStatus, "MATCHED");
  });

  it("Test 2 — manual place override applies only to import preview rows", () => {
    const base = enrichExcelPreviewRows([baseRow("Nahaf")]);
    const edited = updateImportMappingOverride(normalizeImportLocationMappings([NAHAF_MAPPING]), "Nahaf", {
      updatedPlace: "נחף מרכז",
    });
    const updated = applyImportLocationMappingsToRows(base, edited);

    assert.equal(updated[0].city, "נחף מרכז");
    assert.equal(updated[0].resolvedDeliveryPlace, "נחף מרכז");
    assert.equal(updated[0].originalDeliveryPlace, "Nahaf");
    assert.equal(updated[0].deliveryLocationId, null);
    assert.equal(updated[0].locationMatchStatus, "MANUALLY_FIXED");
  });

  it("Test 3 — fresh import still gets global suggestion after prior local override", () => {
    const prior = updateImportMappingOverride(normalizeImportLocationMappings([NAHAF_MAPPING]), "Nahaf", {
      updatedPlace: "נחף מרכז",
    });
    assert.ok(isImportMappingManuallyEdited(prior[0]));

    const freshSuggestion = normalizeImportLocationMappings([NAHAF_MAPPING]);
    assert.equal(freshSuggestion[0].updatedPlace, "נחף");
    assert.equal(isImportMappingManuallyEdited(freshSuggestion[0]), false);
  });

  it("Test 4 — zone override is local to import apply", () => {
    const base = enrichExcelPreviewRows([baseRow("Nahaf")]);
    const edited = updateImportMappingOverride(normalizeImportLocationMappings([NAHAF_MAPPING]), "Nahaf", {
      zoneId: "zone-13",
      zoneName: "צפון 13",
    });
    const updated = applyImportLocationMappingsToRows(base, edited);

    assert.equal(updated[0].zoneId, "zone-13");
    assert.equal(updated[0].zoneName, "צפון 13");
    assert.equal(updated[0].city, "נחף");
    assert.equal(updated[0].deliveryLocationId, "loc-nahaf");
  });

  it("Test 5 — same originalPlace on multiple rows all receive override", () => {
    const base = enrichExcelPreviewRows([
      baseRow("Nahaf", 2),
      baseRow("Nahaf", 3),
      baseRow("Nahaf", 4),
      baseRow("Other", 5),
    ]);
    const edited = updateImportMappingOverride(normalizeImportLocationMappings([NAHAF_MAPPING]), "Nahaf", {
      updatedPlace: "נחף מרכז",
    });
    const updated = applyImportLocationMappingsToRows(base, edited);

    assert.equal(updated.filter((r) => r.city === "נחף מרכז").length, 3);
    assert.equal(updated[3].city, "Other");
    assert.equal(updated[0].originalDeliveryPlace, "Nahaf");
    assert.equal(updated[1].originalDeliveryPlace, "Nahaf");
  });

  it("Test 6 — keeping originals leaves Excel values unchanged", () => {
    const base = enrichExcelPreviewRows([baseRow("שפעמرو")]);
    assert.deepEqual(base, base);
    assert.equal(base[0].city, "שפעמرو");
    assert.equal(base[0].resolvedDeliveryPlace, undefined);
  });

  it("restoreImportMappingToSuggested resets manual edits in import state", () => {
    const normalized = normalizeImportLocationMappings([NAHAF_MAPPING]);
    const edited = updateImportMappingOverride(normalized, "Nahaf", {
      updatedPlace: "נחף מרכז",
      zoneId: "zone-13",
      zoneName: "צפון 13",
    });
    const restored = restoreImportMappingToSuggested(edited[0]);

    assert.equal(restored.updatedPlace, "נחף");
    assert.equal(restored.zoneId, "zone-19");
    assert.equal(restored.deliveryLocationId, "loc-nahaf");
    assert.equal(isImportMappingManuallyEdited(restored), false);
  });
});
