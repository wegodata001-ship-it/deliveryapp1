import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CashExportData } from "@/app/admin/cash-control/export-data";
import * as XLSX from "xlsx";
import { buildCashControlWorkbook } from "@/lib/controls/cash-control-excel";
import { readFileSync } from "node:fs";
import {
  ArchiveVersionConflictError,
  archiveFileName,
  archiveSnapshotForVersion,
  claimNextArchiveVersion,
  freezeArchiveSnapshot,
  isRepeatGeneration,
  nextDocumentVersion,
  retryArchiveVersionWrite,
  type CashFlowArchiveSnapshot,
} from "@/lib/controls/cash-flow-archive.shared";

function sampleAmounts(): CashExportData {
  return {
    week: "AH-10",
    rangeFrom: "2026-03-01",
    rangeTo: "2026-03-07",
    generatedAt: "2026-03-08T00:00:00.000Z",
    totals: {
      receiptsIls: "100.00",
      receiptsUsd: "2600.00",
      expensesIls: "120.00",
      expensesUsd: "0.00",
      expectedIls: "-20.00",
      expectedUsd: "2600.00",
    },
    counted: { ils: null, usd: "2600.00", diffIls: null, diffUsd: "0.00", countedAt: null },
    days: [],
    expenses: [],
    counts: [],
    deviations: [],
  };
}

function sampleSnapshot(): CashFlowArchiveSnapshot {
  return {
    schemaVersion: 1,
    documentVersion: 1,
    weekCode: "AH-10",
    docType: "CASH_FLOW_WEEK",
    generatedAt: "2026-03-08T00:00:00.000Z",
    createdById: "user-1",
    createdByName: "מנהל",
    amounts: sampleAmounts(),
    files: { xlsxBase64: "e30=", pdfBase64: null },
  };
}

describe("cash flow archive versions", () => {
  it("starts at version 1 and increments without replacing the previous version", () => {
    assert.equal(nextDocumentVersion([]), 1);
    assert.equal(isRepeatGeneration([]), false);
    assert.equal(nextDocumentVersion([1]), 2);
    assert.equal(isRepeatGeneration([1]), true);
    assert.equal(nextDocumentVersion([1, 2, 4]), 5);
    assert.equal(archiveFileName("AH-10", 2), "Cash_Flow_AH-10_v2.json");
  });

  it("keeps the stored snapshot after the live source changes", () => {
    const live = sampleAmounts();
    const stored = freezeArchiveSnapshot(sampleSnapshot());
    live.totals.receiptsUsd = "9999.00";
    live.week = "AH-99";
    assert.equal(stored.amounts.totals.receiptsUsd, "2600.00");
    assert.equal(stored.amounts.week, "AH-10");
    assert.equal(stored.amounts.totals.receiptsIls, live.totals.receiptsIls);
    assert.equal(stored.files.xlsxBase64, "e30=");
  });

  it("writes the snapshot totals into the Excel workbook", () => {
    const amounts = sampleAmounts();
    const wb = XLSX.read(buildCashControlWorkbook(amounts), { type: "buffer" });
    const sheet = wb.Sheets["סיכום"];
    assert.ok(sheet);
    assert.equal(sheet["B7"]?.v, 100);
    assert.equal(sheet["B8"]?.v, 2600);
    assert.equal(sheet["C7"]?.v, 120);
    assert.equal(sheet["B2"]?.v, amounts.week);
  });

  it("binds the saved version without changing the Excel or PDF payload", () => {
    const prepared = sampleSnapshot();
    prepared.documentVersion = 0;
    const stored = archiveSnapshotForVersion(prepared, 3);
    prepared.files.xlsxBase64 = "changed";
    prepared.amounts.totals.receiptsUsd = "1.00";
    assert.equal(stored.documentVersion, 3);
    assert.equal(stored.files.xlsxBase64, "e30=");
    assert.equal(stored.files.pdfBase64, null);
    assert.equal(stored.amounts.totals.receiptsUsd, "2600.00");
  });

  it("does not write a second row when a retry follows a failed attempt", async () => {
    const rows: number[] = [];
    let attempts = 0;
    const version = await retryArchiveVersionWrite(async () => {
      attempts += 1;
      const next = nextDocumentVersion(rows);
      if (attempts === 1) throw new ArchiveVersionConflictError();
      rows.push(next);
      return next;
    });
    assert.equal(version, 1);
    assert.deepEqual(rows, [1]);
    assert.equal(attempts, 2);
  });

  it("does not retry a failure that is not a version conflict", async () => {
    let attempts = 0;
    await assert.rejects(
      retryArchiveVersionWrite(async () => {
        attempts += 1;
        throw new Error("pdf renderer failed");
      }),
      /pdf renderer failed/,
    );
    assert.equal(attempts, 1);
  });

  it("creates distinct versions when several saves race", async () => {
    const rows: number[] = [];
    const racers = 8;
    let arrived = 0;
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    await Promise.all(
      Array.from({ length: racers }, () =>
        claimNextArchiveVersion({
          maxAttempts: 20,
          readVersions: async () => {
            const snapshot = rows.slice();
            arrived += 1;
            if (arrived === racers) openGate();
            if (arrived <= racers) await gate;
            return snapshot;
          },
          persist: async (version) => {
            if (rows.includes(version)) throw new ArchiveVersionConflictError();
            rows.push(version);
          },
        }),
      ),
    );

    assert.deepEqual(rows.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("documents a partial unique version index that leaves legacy null rows out", () => {
    const sql = readFileSync(
      "prisma/migrations/20261112140000_document_cash_flow_version_unique/migration.sql",
      "utf8",
    );
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "Document_cash_flow_version_uidx"/);
    assert.match(sql, /"weekCode", "docType", "docVersion"/);
    assert.match(sql, /WHERE "weekCode" IS NOT NULL/);
    assert.match(sql, /"docVersion" IS NOT NULL/);
    assert.match(sql, /duplicate Document version/);
    assert.doesNotMatch(sql, /DELETE FROM "Document"/);
    assert.doesNotMatch(sql, /UPDATE "Document"/);
  });
});
