/**
 * QA: מיפוי כותרות מדויק — מקום מסירה | אזור חלוקה | מקום מסירה מעודכן
 * הרצה: npx tsx scripts/qa-location-alias-import.ts
 */
import { parseLocationAliasImportRows } from "../src/app/admin/shipments/location-service";
import {
  formatLocationAliasImportCommitError,
  validateLocationAliasImportCommitRows,
} from "../src/lib/location-import-commit-validation";
import {
  isValidDistributionAreaName,
  isValidLocalityDisplayName,
  sanitizeDistributionAreaName,
} from "../src/lib/distribution-area-name";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`✓ ${name}`);
}

check("שמות אזור חופשיים — עברית/ערבית/אנגלית", () => {
  for (const name of ["דרום 1", "الجليل", "Zone 7", "מרכז", "منطقة 1"]) {
    assert(isValidDistributionAreaName(name), name);
    assert(sanitizeDistributionAreaName(name) === name, name);
  }
  assert(isValidLocalityDisplayName("רהט"), "rahat locality");
  assert(isValidLocalityDisplayName("الناصرة"), "nazareth");
});

check("Rahat → רהט / דרום 1 לפי כותרות", () => {
  const preview = parseLocationAliasImportRows([
    ["מקומות מסירה", "", ""],
    ["דרך", "", ""],
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["Rahat", "דרום 1", "רהט"],
    ["RAHAT Rahat", "דרום 1", "רהט"],
    ["رهط", "דרום 1", "רהט"],
  ]);
  assert(preview.mappingError == null, `mappingError=${preview.mappingError}`);
  assert(preview.validRows === 3, `valid=${preview.validRows}`);
  const r = preview.rows[0];
  assert(r.areaName === "דרום 1", `area=${r.areaName}`);
});

check("ייבוא ערבית — الناصرة / الجليل", () => {
  const preview = parseLocationAliasImportRows([
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["الناصرة", "الجليل", "الناصرة"],
    ["كفر كنا", "الجليل", "كفر كنا"],
  ]);
  assert(!preview.mappingError, String(preview.mappingError));
  assert(preview.validRows === 2, `valid=${preview.validRows}`);
  assert(preview.rows[0].areaName === "الجليل", preview.rows[0].areaName);
});

check("בלי שורת כותרות → חסימה", () => {
  const preview = parseLocationAliasImportRows([["Rahat", "דרום 1", "רהט"]]);
  assert(preview.mappingError != null, "must block");
});

check("commit validation — שמות חופשיים", () => {
  const preview = parseLocationAliasImportRows([
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["Rahat", "דרום 1", "רהט"],
    ["x", "الجليل", "الناصرة"],
    ["y", "Zone 7", "Bethlehem"],
  ]);
  const valid = preview.rows.filter((r) => r.valid);
  const v = validateLocationAliasImportCommitRows(valid);
  assert(v.ok === true, v.ok === false ? formatLocationAliasImportCommitError(v) : "ok");
});

console.log(`\nQA location alias import: ${n} checks passed`);
