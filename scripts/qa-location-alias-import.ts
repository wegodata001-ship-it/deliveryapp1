/**
 * QA: מיפוי כותרות מדויק — מקום מסירה | אזור חלוקה | מקום מסירה מעודכן
 * הרצה: npx tsx scripts/qa-location-alias-import.ts
 */
import { parseLocationAliasImportRows } from "../src/app/admin/shipments/location-service";
import {
  looksLikeDistributionArea,
  looksLikeLocalityName,
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

check("זיהוי אזור מול יישוב (גם 1 דרום)", () => {
  assert(looksLikeDistributionArea("דרום 1"), "south");
  assert(looksLikeDistributionArea("1 דרום"), "south rtl");
  assert(looksLikeDistributionArea("צפון 16"), "north");
  assert(!looksLikeDistributionArea("רהט"), "rahat not zone");
  assert(looksLikeLocalityName("רהט"), "rahat locality");
  assert(looksLikeLocalityName("אבו סנאן"), "abu");
  assert(!looksLikeLocalityName("1 דרום"), "1 darom not locality");
});

check("Rahat → רהט / דרום 1 לפי כותרות", () => {
  const preview = parseLocationAliasImportRows([
    ["מקומות מסירה", "", ""], // metadata — דילוג
    ["דרך", "", ""],
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["Rahat", "דרום 1", "רהט"],
    ["RAHAT Rahat", "דרום 1", "רהט"],
    ["رهط", "דרום 1", "רהט"],
  ]);
  assert(preview.mappingError == null, `mappingError=${preview.mappingError}`);
  assert(preview.headerRowIndex === 2, `headerRow=${preview.headerRowIndex}`);
  assert(preview.columnMap?.originalIdx === 0, "orig col");
  assert(preview.columnMap?.areaIdx === 1, "area col");
  assert(preview.columnMap?.updatedIdx === 2, "updated col");
  assert(preview.validRows === 3, `valid=${preview.validRows}`);
  const r = preview.rows[0];
  assert(r.originalName === "Rahat", r.originalName);
  assert(r.displayName === "רהט", `display=${r.displayName}`);
  assert(r.areaName === "דרום 1", `area=${r.areaName}`);
});

check("אבו סנאן", () => {
  const preview = parseLocationAliasImportRows([
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["abu sinan Abu sinan", "צפון 16", "אבו סנאן"],
  ]);
  assert(!preview.mappingError, String(preview.mappingError));
  const r = preview.rows[0];
  assert(r.valid, r.error ?? "valid");
  assert(r.originalName === "abu sinan Abu sinan", "orig");
  assert(r.displayName === "אבו סנאן", "updated");
  assert(r.areaName === "צפון 16", "area");
});

check("עמודות הפוכות בנתונים → שגיאת מיפוי", () => {
  const preview = parseLocationAliasImportRows([
    ["מקום מסירה", "אזור חלוקה", "מקום מסירה מעודכן"],
    ["Rahat", "רהט", "דרום 1"], // ערכים הפוכים תחת כותרות נכונות
  ]);
  assert(preview.validRows === 0, "no valid");
  assert(preview.rows[0].error?.includes("מיפוי העמודות אינו תקין"), preview.rows[0].error);
});

check("בלי שורת כותרות → חסימה", () => {
  const preview = parseLocationAliasImportRows([
    ["Rahat", "דרום 1", "רהט"],
  ]);
  assert(preview.mappingError != null, "must block");
  assert(preview.validRows === 0, "no rows");
});

console.log(`\nQA location alias import: ${n} checks passed`);
