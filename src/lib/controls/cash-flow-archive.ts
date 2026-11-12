import "server-only";

import { randomUUID } from "crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCashExportData, type CashExportData } from "@/app/admin/cash-control/export-data";
import { buildCashControlWorkbook } from "@/lib/controls/cash-control-excel";
import {
  archiveFileName,
  archiveSnapshotForVersion,
  archiveVersionLockKey,
  CASH_FLOW_ARCHIVE_DOC_TYPE,
  CASH_FLOW_ARCHIVE_ENTITY,
  claimNextArchiveVersion,
  freezeArchiveSnapshot,
  retryArchiveVersionWrite,
  type CashFlowArchiveSnapshot,
} from "@/lib/controls/cash-flow-archive.shared";

export type CashFlowArchiveListItem = {
  id: string;
  weekCode: string;
  version: number;
  createdAt: string;
  createdByName: string | null;
  hasPdf: boolean;
  hasExcel: boolean;
};

export type SaveCashFlowArchiveResult = {
  id: string;
  weekCode: string;
  version: number;
  repeat: boolean;
  previousVersion: number | null;
  hasPdf: boolean;
};

function isSnapshot(value: unknown): value is CashFlowArchiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CashFlowArchiveSnapshot>;
  return row.schemaVersion === 1 && row.docType === CASH_FLOW_ARCHIVE_DOC_TYPE && !!row.amounts && !!row.files;
}

async function loadHebrewFont(): Promise<{ family: string; mimeType: string; base64: string }> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return { family: "Noto Sans Hebrew", mimeType: "font/ttf", base64: bytes.toString("base64") };
}

async function renderPdfBase64(amounts: CashExportData): Promise<string | null> {
  try {
    const [{ buildCashControlPdfHtml }, { renderHtmlToPdf }] = await Promise.all([
      import("@/lib/controls/cash-control-pdf-html"),
      import("@/lib/pdf/browser"),
    ]);
    const html = buildCashControlPdfHtml(amounts, await loadHebrewFont());
    const bytes = await renderHtmlToPdf(html);
    return bytes ? Buffer.from(bytes).toString("base64") : null;
  } catch (error) {
    console.error("[cash-flow-archive] pdf skipped", error);
    return null;
  }
}

export async function listCashFlowArchive(weekCode: string): Promise<CashFlowArchiveListItem[]> {
  const week = weekCode.trim();
  const rows = await prisma.document.findMany({
    where: {
      entityType: CASH_FLOW_ARCHIVE_ENTITY,
      entityId: week,
      docType: CASH_FLOW_ARCHIVE_DOC_TYPE,
      deletedAt: null,
    },
    orderBy: [{ docVersion: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      weekCode: true,
      docVersion: true,
      createdAt: true,
      uploadedByName: true,
      snapshot: true,
    },
  });
  return rows.flatMap((row) => {
    if (!isSnapshot(row.snapshot)) return [];
    return [
      {
        id: row.id,
        weekCode: row.weekCode ?? row.snapshot.weekCode,
        version: row.docVersion ?? row.snapshot.documentVersion,
        createdAt: row.createdAt.toISOString(),
        createdByName: row.uploadedByName,
        hasPdf: Boolean(row.snapshot.files.pdfBase64),
        hasExcel: Boolean(row.snapshot.files.xlsxBase64),
      },
    ];
  });
}

export async function saveCashFlowArchive(
  weekCode: string,
  user: { id: string; fullName: string | null },
): Promise<SaveCashFlowArchiveResult> {
  const week = weekCode.trim();
  const amounts = await getCashExportData(week);
  const workbook = buildCashControlWorkbook(amounts);
  const pdfBase64 = await renderPdfBase64(amounts);
  const prepared = freezeArchiveSnapshot({
    schemaVersion: 1,
    documentVersion: 0,
    weekCode: week,
    docType: CASH_FLOW_ARCHIVE_DOC_TYPE,
    generatedAt: new Date().toISOString(),
    createdById: user.id,
    createdByName: user.fullName,
    amounts,
    files: {
      xlsxBase64: Buffer.from(workbook).toString("base64"),
      pdfBase64,
    },
  });
  const lockKey = archiveVersionLockKey(week, CASH_FLOW_ARCHIVE_DOC_TYPE);
  const saved = await retryArchiveVersionWrite(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      const id = randomUUID();
      const claimed = await claimNextArchiveVersion({
        readVersions: async () => {
          const existing = await tx.document.findMany({
            where: {
              entityType: CASH_FLOW_ARCHIVE_ENTITY,
              entityId: week,
              docType: CASH_FLOW_ARCHIVE_DOC_TYPE,
            },
            select: { docVersion: true },
          });
          return existing.map((row) => row.docVersion ?? 0);
        },
        // התנגשות בתוך הטרנזקציה מבטלת אותה. הניסיון החוזר חייב להתחיל טרנזקציה חדשה.
        maxAttempts: 1,
        persist: async (version) => {
          const snapshot = archiveSnapshotForVersion(prepared, version);
          await tx.document.create({
            data: {
              id,
              entityType: CASH_FLOW_ARCHIVE_ENTITY,
              entityId: week,
              docType: CASH_FLOW_ARCHIVE_DOC_TYPE,
              fileName: archiveFileName(week, version),
              bucket: "inline",
              storagePath: `inline/${id}`,
              mimeType: "application/json",
              fileSize: Buffer.byteLength(JSON.stringify(snapshot)),
              uploadedById: user.id,
              uploadedByName: user.fullName,
              isAuto: true,
              weekCode: week,
              docVersion: version,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
        },
      });
      return { id, ...claimed };
    }),
  );
  return {
    id: saved.id,
    weekCode: week,
    version: saved.version,
    repeat: saved.repeat,
    previousVersion: saved.previousVersion,
    hasPdf: pdfBase64 != null,
  };
}

export async function readCashFlowArchiveFile(
  id: string,
  format: "pdf" | "excel" | "json",
): Promise<{ fileName: string; mimeType: string; bytes: Buffer } | null> {
  const row = await prisma.document.findFirst({
    where: { id, docType: CASH_FLOW_ARCHIVE_DOC_TYPE, deletedAt: null },
    select: { snapshot: true, weekCode: true, docVersion: true },
  });
  if (!row || !isSnapshot(row.snapshot)) return null;
  const version = row.docVersion ?? row.snapshot.documentVersion;
  const week = row.weekCode ?? row.snapshot.weekCode;
  if (format === "json") {
    const copy = { ...row.snapshot, files: { xlsxBase64: "", pdfBase64: null } };
    return {
      fileName: archiveFileName(week, version),
      mimeType: "application/json",
      bytes: Buffer.from(JSON.stringify(copy)),
    };
  }
  if (format === "excel") {
    const raw = row.snapshot.files.xlsxBase64;
    if (!raw) return null;
    return {
      fileName: `Cash_Flow_${week.replace(/[^\w-]/g, "_")}_v${version}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: Buffer.from(raw, "base64"),
    };
  }
  const pdf = row.snapshot.files.pdfBase64;
  if (!pdf) return null;
  return {
    fileName: `Cash_Flow_${week.replace(/[^\w-]/g, "_")}_v${version}.pdf`,
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf, "base64"),
  };
}
