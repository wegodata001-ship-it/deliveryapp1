import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerSearchRow } from "@/app/admin/capture/actions";
import {
  pickAutoCustomerHit,
  resolveCustomerEnterSelection,
} from "@/lib/customer-search-client";

function row(partial: { id: string; code?: string | null; label?: string; oldCustomerCode?: string | null }): CustomerSearchRow {
  return {
    id: partial.id,
    label: partial.label ?? `Customer ${partial.code ?? partial.id}`,
    code: partial.code ?? null,
    customerType: null,
    city: null,
    phone: null,
    oldCustomerCode: partial.oldCustomerCode ?? null,
  };
}

describe("pickAutoCustomerHit", () => {
  it("picks the only row", () => {
    const only = row({ id: "a", code: "103" });
    assert.equal(pickAutoCustomerHit([only], "103"), only);
  });

  it("picks exact code among several results", () => {
    const exact = row({ id: "a", code: "103" });
    const hits = [exact, row({ id: "b", code: "1030" }), row({ id: "c", code: "1031" })];
    assert.equal(pickAutoCustomerHit(hits, "103"), exact);
  });

  it("returns null when several results and no exact code", () => {
    const hits = [row({ id: "a", code: "102" }), row({ id: "b", code: "105" })];
    assert.equal(pickAutoCustomerHit(hits, "10"), null);
  });
});

describe("resolveCustomerEnterSelection", () => {
  const ahmad = row({ id: "c103", code: "103", label: "אחמד" });
  const other = row({ id: "c1030", code: "1030", label: "אחר" });

  it("103 + ENTER with exact match picks that customer", () => {
    const decision = resolveCustomerEnterSelection({
      query: "103",
      hits: [ahmad, other],
      activeIndex: -1,
      hitsQuery: "103",
      field: "code",
    });
    assert.deepEqual(decision, { action: "pick", row: ahmad });
  });

  it("ENTER picks the highlighted row", () => {
    const decision = resolveCustomerEnterSelection({
      query: "10",
      hits: [ahmad, other],
      activeIndex: 1,
      hitsQuery: "10",
      field: "code",
    });
    assert.deepEqual(decision, { action: "pick", row: other });
  });

  it("ENTER picks the first row when several fresh results and no highlight", () => {
    const first = row({ id: "c102", code: "102" });
    const second = row({ id: "c105", code: "105" });
    const decision = resolveCustomerEnterSelection({
      query: "10",
      hits: [first, second],
      activeIndex: -1,
      hitsQuery: "10",
      field: "code",
    });
    assert.deepEqual(decision, { action: "pick", row: first });
  });

  it("does not pick a previous customer when the code is unknown", () => {
    const decision = resolveCustomerEnterSelection({
      query: "999",
      hits: [ahmad],
      activeIndex: -1,
      hitsQuery: "103",
      field: "code",
      alreadySelected: { id: "c103", code: "103" },
    });
    assert.deepEqual(decision, { action: "lookup" });
  });

  it("does not re-select the already chosen exact code", () => {
    const decision = resolveCustomerEnterSelection({
      query: "103",
      hits: [],
      activeIndex: -1,
      hitsQuery: null,
      field: "code",
      alreadySelected: { id: "c103", code: "103" },
    });
    assert.deepEqual(decision, { action: "none" });
  });

  it("unknown code with a completed empty search → none", () => {
    const decision = resolveCustomerEnterSelection({
      query: "999",
      hits: [],
      activeIndex: -1,
      hitsQuery: "999",
      field: "code",
    });
    assert.deepEqual(decision, { action: "none" });
  });

  it("fast ENTER before results arrive → lookup", () => {
    const decision = resolveCustomerEnterSelection({
      query: "103",
      hits: [],
      activeIndex: -1,
      hitsQuery: null,
      field: "code",
    });
    assert.deepEqual(decision, { action: "lookup" });
  });

  it("does not pick a stale first hit from a previous query", () => {
    const staleFirst = row({ id: "c102", code: "102" });
    const decision = resolveCustomerEnterSelection({
      query: "105",
      hits: [staleFirst, row({ id: "c103", code: "103" })],
      activeIndex: -1,
      hitsQuery: "10",
      field: "code",
    });
    assert.deepEqual(decision, { action: "lookup" });
  });

  it("picks an exact code even if the list is still from a prefix search", () => {
    const exact = row({ id: "c103", code: "103", label: "אחמד" });
    const decision = resolveCustomerEnterSelection({
      query: "103",
      hits: [exact, row({ id: "c102", code: "102" })],
      activeIndex: -1,
      hitsQuery: "10",
      field: "code",
    });
    assert.deepEqual(decision, { action: "pick", row: exact });
  });
});
