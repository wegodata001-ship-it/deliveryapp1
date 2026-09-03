import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLedgerExportFilename,
  buildLedgerPdfDownloadFilename,
  ledgerPdfContentDisposition,
} from "@/lib/customer-ledger-export";

describe("ledger PDF download filename", () => {
  it("uses a safe ASCII name with customer code and date", () => {
    const name = buildLedgerPdfDownloadFilename({ customerCode: "110", variant: "full" });
    assert.match(name, /^customer-ledger-110-\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.doesNotMatch(name, /[^\x20-\x7E]/);
  });

  it("marks manual selection in the filename", () => {
    const name = buildLedgerPdfDownloadFilename({ customerCode: "עלי 110", variant: "manual" });
    assert.match(name, /^customer-ledger-110-selected-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("keeps Excel filenames unchanged", () => {
    const name = buildLedgerExportFilename("110", "xlsx");
    assert.match(name, /^ledger_110_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("uses attachment Content-Disposition", () => {
    const header = ledgerPdfContentDisposition("customer-ledger-110-2026-09-03.pdf");
    assert.match(header, /^attachment;/);
    assert.match(header, /filename="customer-ledger-110-2026-09-03\.pdf"/);
    assert.doesNotMatch(header, /inline/);
  });
});
