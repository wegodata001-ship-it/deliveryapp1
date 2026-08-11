import { distributionAreaValidationError } from "@/lib/distribution-area-name";

export type LocationAliasImportCommitRow = {
  rowIndex: number;
  displayName: string;
  areaName: string | null;
  valid: boolean;
};

export type LocationAliasImportCommitValidation =
  | { ok: true }
  | {
      ok: false;
      rowIndex: number;
      field: string;
      value: string;
      message: string;
    };

/** בדיקות pre-commit — שמות חופשיים בלבד */
export function validateLocationAliasImportCommitRows(
  rows: LocationAliasImportCommitRow[],
): LocationAliasImportCommitValidation {
  for (const r of rows) {
    if (!r.valid) continue;

    if (r.areaName) {
      const areaErr = distributionAreaValidationError(r.areaName);
      if (areaErr) {
        return {
          ok: false,
          rowIndex: r.rowIndex,
          field: "אזור חלוקה",
          value: r.areaName,
          message: areaErr,
        };
      }
    }
  }

  return { ok: true };
}

export function formatLocationAliasImportCommitError(
  v: Extract<LocationAliasImportCommitValidation, { ok: false }>,
): string {
  return `שורה ${v.rowIndex} · ${v.field}: «${v.value}» — ${v.message}`;
}

export function formatLocationAliasImportResultErrors(
  errors: Array<{ rowIndex: number; error: string }>,
  max = 5,
): string {
  if (errors.length === 0) return "";
  const lines = errors.slice(0, max).map((e) => `שורה ${e.rowIndex}: ${e.error}`);
  const more = errors.length > max ? `\n… ועוד ${errors.length - max} שגיאות` : "";
  return `${lines.join("\n")}${more}`;
}
