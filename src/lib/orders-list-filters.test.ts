import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countAdvancedFilters, type OrderFilters } from "@/lib/orders-list-filters";

function emptyFilters(overrides: Partial<OrderFilters> = {}): OrderFilters {
  return {
    week: "AH-1",
    dateFrom: "2026-08-30",
    dateTo: "2026-09-05",
    search: "",
    country: [],
    paymentMethod: [],
    paymentStatus: [],
    status: [],
    orderNumber: "",
    phone: "",
    paymentLocation: "",
    createdBy: [],
    minAmountUsd: "",
    maxAmountUsd: "",
    openOnly: false,
    completedOnly: false,
    ordersCompleted: "all",
    ...overrides,
  };
}

describe("countAdvancedFilters", () => {
  it("counts only applied advanced fields", () => {
    assert.equal(countAdvancedFilters(emptyFilters(), false), 0);
    assert.equal(
      countAdvancedFilters(
        emptyFilters({
          phone: "050",
          orderNumber: "12",
          country: ["IL"],
        }),
        true,
      ),
      4,
    );
  });
});
