import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLocationAliasImportCommitError,
  validateLocationAliasImportCommitRows,
  type LocationAliasImportCommitRow,
} from "@/lib/location-import-commit-validation";

function row(
  partial: Partial<LocationAliasImportCommitRow> & Pick<LocationAliasImportCommitRow, "rowIndex">,
): LocationAliasImportCommitRow {
  return {
    displayName: partial.displayName ?? "display",
    areaName: partial.areaName ?? null,
    valid: partial.valid ?? true,
    rowIndex: partial.rowIndex,
  };
}

describe("validateLocationAliasImportCommitRows", () => {
  it("allows valid locality and area names in Hebrew, Arabic and English", () => {
    const rows = [
      row({ rowIndex: 2, displayName: "רהט", areaName: "דרום 1" }),
      row({ rowIndex: 3, displayName: "الناصرة", areaName: "الجليل" }),
      row({ rowIndex: 4, displayName: "Bethlehem", areaName: "Center" }),
      row({ rowIndex: 5, displayName: "צפון", areaName: "منطقة 1" }),
    ];
    assert.deepEqual(validateLocationAliasImportCommitRows(rows), { ok: true });
  });

  it("blocks invalid area names with row details", () => {
    const rows = [row({ rowIndex: 4, displayName: "רהט", areaName: "אזור חלוקה" })];
    const v = validateLocationAliasImportCommitRows(rows);
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.equal(v.rowIndex, 4);
      assert.equal(v.field, "אזור חלוקה");
      assert.match(formatLocationAliasImportCommitError(v), /שורה 4/);
    }
  });

  it("skips invalid preview rows", () => {
    const rows = [
      row({ rowIndex: 2, valid: false, displayName: "x", areaName: "y" }),
      row({ rowIndex: 3, displayName: "רהט", areaName: "الجليل" }),
    ];
    assert.deepEqual(validateLocationAliasImportCommitRows(rows), { ok: true });
  });
});
