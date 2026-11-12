/**
 * גרסה ו-snapshot למסמך בקרת תזרים.
 * המסמך שנשמר לא נקרא מחדש מהנתונים החיים.
 */

import type { CashExportData } from "@/app/admin/cash-control/export-data";

export const CASH_FLOW_ARCHIVE_DOC_TYPE = "CASH_FLOW_WEEK";
export const CASH_FLOW_ARCHIVE_ENTITY = "REPORT";

export type CashFlowArchiveSnapshot = {
  schemaVersion: 1;
  documentVersion: number;
  weekCode: string;
  docType: typeof CASH_FLOW_ARCHIVE_DOC_TYPE;
  generatedAt: string;
  createdById: string | null;
  createdByName: string | null;
  amounts: CashExportData;
  files: {
    xlsxBase64: string;
    pdfBase64: string | null;
  };
};

export function nextDocumentVersion(existingVersions: number[]): number {
  let max = 0;
  for (const version of existingVersions) {
    if (Number.isFinite(version) && version > max) max = version;
  }
  return max + 1;
}

export function isRepeatGeneration(existingVersions: number[]): boolean {
  return existingVersions.some((version) => Number.isFinite(version) && version > 0);
}

export function freezeArchiveSnapshot(snapshot: CashFlowArchiveSnapshot): CashFlowArchiveSnapshot {
  return structuredClone(snapshot);
}

export function archiveFileName(weekCode: string, version: number): string {
  const safeWeek = weekCode.replace(/[^\w-]/g, "_");
  return `Cash_Flow_${safeWeek}_v${version}.json`;
}

export function archiveVersionLockKey(weekCode: string, docType: string): string {
  return `cash-flow-archive:${docType}:${weekCode}`;
}

/** ה-snapshot שנשמר נושא את אותה גרסה שנכתבה לשורה, בלי לשנות את קובצי המקור. */
export function archiveSnapshotForVersion(
  snapshot: CashFlowArchiveSnapshot,
  version: number,
): CashFlowArchiveSnapshot {
  return freezeArchiveSnapshot({ ...snapshot, documentVersion: version });
}

export class ArchiveVersionConflictError extends Error {
  constructor() {
    super("archive version conflict");
    this.name = "ArchiveVersionConflictError";
  }
}

export function isArchiveVersionConflict(error: unknown): boolean {
  if (error instanceof ArchiveVersionConflictError) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "P2002" || code === "P2034" || code === "40001" || code === "40P01";
}

/**
 * ניסיון חוזר רק כשהכתיבה נכשלה ולא נשמרה.
 * הצלחה חוזרת מיד, ולכן אותה פעולה לא נכתבת פעמיים.
 */
export async function retryArchiveVersionWrite<T>(
  write: () => Promise<T>,
  maxAttempts = 8,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      last = error;
      if (!isArchiveVersionConflict(error) || attempt === maxAttempts) throw error;
    }
  }
  throw last instanceof Error ? last : new Error("archive version write failed");
}

export async function claimNextArchiveVersion(input: {
  readVersions: () => Promise<number[]>;
  persist: (version: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<{ version: number; repeat: boolean; previousVersion: number | null }> {
  return retryArchiveVersionWrite(async () => {
    const versions = await input.readVersions();
    const version = nextDocumentVersion(versions);
    const repeat = isRepeatGeneration(versions);
    await input.persist(version);
    return {
      version,
      repeat,
      previousVersion: repeat ? Math.max(...versions) : null,
    };
  }, input.maxAttempts);
}
