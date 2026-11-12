import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeCustomerBooks } from "@/lib/flow-control/customer-books-display";
import { computeOpenDebtUsd } from "@/lib/finance-data/ledger/compute-open-debt";

describe("customer books display", () => {
  it("keeps open debt and credit apart for the controlled scenario", () => {
    const orders = [
      [1000, 1000],
      [1500, 500],
      [800, 1000],
      [2000, 1200],
      [750, 750],
      [900, 900],
      [1200, 0],
    ];
    const books = summarizeCustomerBooks(
      orders.map(([total, paid]) => computeOpenDebtUsd({ orderId: "", totalUsd: total!, paidUsd: paid! }).openDebtUsd),
    );
    assert.equal(books.openDebtUsd, 3000);
    assert.equal(books.creditUsd, 200);
    assert.equal(books.booksNetUsd, 2800);
  });

  it("does not fold one customer's credit into another customer's debt", () => {
    const books = summarizeCustomerBooks([1000, -200]);
    assert.equal(books.openDebtUsd, 1000);
    assert.equal(books.creditUsd, 200);
    assert.notEqual(books.openDebtUsd, books.booksNetUsd);
  });
});
