export const LOCATION_ALIAS_IMPORT_ERROR_CODES = [
  "MISSING_SOURCE_PLACE",
  "MISSING_UPDATED_PLACE",
  "MISSING_DELIVERY_AREA",
  "INVALID_DELIVERY_AREA",
  "INVALID_SOURCE_NAME",
  "INVALID_DISPLAY_NAME",
  "DUPLICATE_MAPPING",
  "AMBIGUOUS_MATCH",
  "INVALID_ROW",
  "DATABASE_ERROR",
  "LOCATION_NOT_CREATED",
] as const;

export type LocationAliasImportErrorCode =
  (typeof LOCATION_ALIAS_IMPORT_ERROR_CODES)[number];

export const LOCATION_ALIAS_IMPORT_ERROR_LABELS: Record<
  LocationAliasImportErrorCode,
  string
> = {
  MISSING_SOURCE_PLACE: "חסר מקום מסירה מקורי",
  MISSING_UPDATED_PLACE: "חסר מקום מסירה מעודכן",
  MISSING_DELIVERY_AREA: "לא הוגדר אזור חלוקה",
  INVALID_DELIVERY_AREA: "אזור החלוקה אינו תקין",
  INVALID_SOURCE_NAME: "שם מקורי לא תקין לאחר נרמול",
  INVALID_DISPLAY_NAME: "מקום מסירה מעודכן אינו שם תקין",
  DUPLICATE_MAPPING: "קיימת כבר התאמה זהה בקובץ",
  AMBIGUOUS_MATCH: "נמצאו מספר התאמות אפשריות",
  INVALID_ROW: "השורה אינה תקינה",
  DATABASE_ERROR: "שמירת השורה נכשלה",
  LOCATION_NOT_CREATED: "יישוב לא נוצר",
};

export function locationAliasImportErrorLabel(
  code: LocationAliasImportErrorCode | null | undefined,
  fallback?: string | null,
): string {
  if (code && LOCATION_ALIAS_IMPORT_ERROR_LABELS[code]) {
    return LOCATION_ALIAS_IMPORT_ERROR_LABELS[code];
  }
  return fallback?.trim() || "שגיאה לא ידועה";
}

export function inferLocationAliasImportErrorCode(
  message: string | null | undefined,
): LocationAliasImportErrorCode | null {
  const m = message?.trim() ?? "";
  if (!m) return null;
  if (m.includes("חסר מקום מסירה מעודכן")) return "MISSING_UPDATED_PLACE";
  if (m.includes("חסר מקום מסירה")) return "MISSING_SOURCE_PLACE";
  if (m.includes("חסר אזור")) return "MISSING_DELIVERY_AREA";
  if (m.includes("אזור חלוקה לא תקין") || m.includes("שם קצר מדי")) {
    return "INVALID_DELIVERY_AREA";
  }
  if (m.includes("שם מקורי לא תקין")) return "INVALID_SOURCE_NAME";
  if (m.includes("מקום מסירה מעודכן אינו")) return "INVALID_DISPLAY_NAME";
  if (m.includes("כפול") || m.includes("כפילות")) return "DUPLICATE_MAPPING";
  if (m.includes("מספר התאמות")) return "AMBIGUOUS_MATCH";
  if (m.includes("יישוב לא נוצר")) return "LOCATION_NOT_CREATED";
  if (m.includes("שמירה") || m.includes("מסד")) return "DATABASE_ERROR";
  return "INVALID_ROW";
}
