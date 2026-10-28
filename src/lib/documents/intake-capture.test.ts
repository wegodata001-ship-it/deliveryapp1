import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentDuplicateKey,
  documentsArchiveFilterToSearchParams,
  documentsArchiveHref,
  EMPTY_DOCUMENTS_ARCHIVE_FILTER,
  isAllowedIntakeCaptureFile,
  parseDocumentsArchiveFilter,
} from "@/lib/documents/intake-capture";

describe("isAllowedIntakeCaptureFile", () => {
  it("accepts payment intake file types", () => {
    assert.equal(isAllowedIntakeCaptureFile("scan.PDF"), true);
    assert.equal(isAllowedIntakeCaptureFile("a.jpg"), true);
    assert.equal(isAllowedIntakeCaptureFile("a.jpeg"), true);
    assert.equal(isAllowedIntakeCaptureFile("a.png"), true);
    assert.equal(isAllowedIntakeCaptureFile("a.webp"), true);
    assert.equal(isAllowedIntakeCaptureFile("a.bin"), false);
    assert.equal(isAllowedIntakeCaptureFile("noext", "application/pdf"), true);
  });
});

describe("documentDuplicateKey", () => {
  it("normalizes name and size for the same entity", () => {
    const a = documentDuplicateKey({
      entityType: "PAYMENT",
      entityId: "p1",
      fileName: "Scan.JPG",
      fileSize: 1200.4,
    });
    const b = documentDuplicateKey({
      entityType: "PAYMENT",
      entityId: "p1",
      fileName: "scan.jpg",
      fileSize: 1200,
    });
    assert.equal(a, b);
  });
});

describe("documents archive filters", () => {
  it("does not inject the current week when params are empty", () => {
    const parsed = parseDocumentsArchiveFilter(new URLSearchParams());
    assert.deepEqual(parsed, EMPTY_DOCUMENTS_ARCHIVE_FILTER);
    assert.equal(parsed.weekCode, "");
    assert.equal(documentsArchiveHref(parsed), "/admin/documents");
  });

  it("round-trips persisted search params without snapping week", () => {
    const parsed = parseDocumentsArchiveFilter(
      new URLSearchParams("q=101&week=AH-141&view=cards&page=2&uploadedBy=dana"),
    );
    assert.equal(parsed.q, "101");
    assert.equal(parsed.weekCode, "AH-141");
    assert.equal(parsed.view, "cards");
    assert.equal(parsed.page, 2);
    assert.equal(parsed.uploadedBy, "dana");
    const qs = documentsArchiveFilterToSearchParams(parsed);
    assert.equal(qs.get("week"), "AH-141");
    assert.equal(qs.get("q"), "101");
    assert.equal(documentsArchiveHref(parsed).includes("week=AH-141"), true);
  });
});
