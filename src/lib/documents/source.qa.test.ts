import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJpegPdf } from "@/lib/documents/images-to-pdf";
import {
  buildDocumentStoragePath,
  cameraFileName,
  canAttachDraftDocuments,
  documentSourceFromStoragePath,
  isDraftDocumentEntityId,
} from "@/lib/documents/source";

describe("document camera archive rules", () => {
  it("stores camera and upload sources in the storage path", () => {
    const camera = buildDocumentStoragePath({
      folder: "orders",
      entityId: "order-1",
      documentId: "doc-1",
      fileName: "scan.jpg",
      source: "CAMERA",
    });
    const upload = buildDocumentStoragePath({
      folder: "payments",
      entityId: "pay-1",
      documentId: "doc-2",
      fileName: "receipt.pdf",
      source: "UPLOAD",
    });
    assert.equal(documentSourceFromStoragePath(camera), "CAMERA");
    assert.equal(documentSourceFromStoragePath(upload), "UPLOAD");
    assert.equal(documentSourceFromStoragePath("orders/legacy/file.pdf"), null);
  });

  it("attaches a draft only after the real record id exists", () => {
    assert.equal(canAttachDraftDocuments("draft-abc", "payment-1"), true);
    assert.equal(canAttachDraftDocuments("draft-abc", ""), false);
    assert.equal(canAttachDraftDocuments("draft-abc", "draft-abc"), false);
    assert.equal(canAttachDraftDocuments("payment-1", "payment-2"), false);
    assert.equal(isDraftDocumentEntityId("draft-order"), true);
  });

  it("names a camera file with a safe extension", () => {
    const name = cameraFileName(new Date(2026, 10, 12, 14, 5, 9), "jpg");
    assert.equal(name, "scan-20261112-140509.jpg");
  });

  it("builds one PDF from several JPEG pages without recompressing them", () => {
    const first = new Uint8Array([0xff, 0xd8, 0x11, 0x22]);
    const second = new Uint8Array([0xff, 0xd8, 0x33, 0x44, 0x55]);
    const pdf = buildJpegPdf([
      { jpeg: first, width: 100, height: 200 },
      { jpeg: second, width: 300, height: 400 },
    ]);
    const head = new TextDecoder().decode(pdf.slice(0, 8));
    assert.equal(head, "%PDF-1.4");
    assert.ok(pdf.includes(first[2]));
    const body = new TextDecoder().decode(pdf);
    assert.match(body, /\/Count 2/);
    assert.match(body, /\/Filter \/DCTDecode/);
    assert.throws(() => buildJpegPdf([]), /אין עמודים/);
    assert.throws(() => buildJpegPdf([{ jpeg: new Uint8Array([1, 2, 3, 4]), width: 10, height: 10 }]), /JPEG/);
  });
});
