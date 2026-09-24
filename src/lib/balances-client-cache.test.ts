import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerBalancesPayload } from "@/app/admin/balances/actions";
import {
  balancesListCacheKey,
  fetchBalancesListCached,
  getBalancesListCache,
  invalidateBalancesListCache,
  setBalancesListCache,
} from "@/lib/balances-client-cache";

function emptyPayload(weekTag: string): CustomerBalancesPayload {
  return {
    rows: [],
    page: 1,
    limit: 25,
    totalRows: 0,
    totalPages: 1,
    stats: {
      totalDebtIls: weekTag,
      totalCreditIls: "0",
      totalPaymentsIls: "0",
      totalDebtUsd: "0",
      totalCreditUsd: "0",
      totalPaymentsUsd: "0",
      withDebtCount: 0,
      withCreditCount: 0,
      noDebtCount: 0,
      partialCount: 0,
      notPaidCount: 0,
      highDebtCount: 0,
      withPaymentsCount: 0,
      totalOrdersBeforeCommissionUsd: "0",
      totalOrdersAfterCommissionUsd: "0",
      totalCodeWithdrawalUsd: "0",
      totalNetBalanceUsd: "0",
      totalLifetimeOrdersUsd: "0",
    },
    statusBalanceKpis: {
      NEW: "0",
      CONFIRMED: "0",
      PROCESSING: "0",
      READY: "0",
      SHIPPED: "0",
      DELIVERED: "0",
      CANCELLED: "0",
      DEBT_WITHDRAWAL: "0",
    },
    activeOrderStatusFilter: "ALL",
  } as unknown as CustomerBalancesPayload;
}

describe("balancesListCacheKey", () => {
  it("differs by week so AH-137 cannot reuse AH-138", () => {
    const a = balancesListCacheKey({ page: 1, weekCode: "AH-138", toYmd: "2026-08-29", sourceCountry: "TURKEY" });
    const b = balancesListCacheKey({ page: 1, weekCode: "AH-137", toYmd: "2026-08-22", sourceCountry: "TURKEY" });
    assert.notEqual(a, b);
  });

  it("differs by country", () => {
    const a = balancesListCacheKey({ page: 1, weekCode: "AH-138", sourceCountry: "TURKEY" });
    const b = balancesListCacheKey({ page: 1, weekCode: "AH-138", sourceCountry: "GREECE" });
    assert.notEqual(a, b);
  });

  it("same week + country + filters share a key", () => {
    const a = balancesListCacheKey({ page: 1, weekCode: "AH-138", sourceCountry: "TURKEY", filters: { sort: "balance_desc" } });
    const b = balancesListCacheKey({ page: 1, weekCode: "AH-138", sourceCountry: "TURKEY", filters: { sort: "balance_desc" } });
    assert.equal(a, b);
  });
});

describe("balances client cache", () => {
  it("returns the payload stored for that key only", () => {
    invalidateBalancesListCache();
    const k138 = balancesListCacheKey({ page: 1, weekCode: "AH-138" });
    const k137 = balancesListCacheKey({ page: 1, weekCode: "AH-137" });
    setBalancesListCache(k138, emptyPayload("138"));
    setBalancesListCache(k137, emptyPayload("137"));
    assert.equal(getBalancesListCache(k138)?.stats.totalDebtIls, "138");
    assert.equal(getBalancesListCache(k137)?.stats.totalDebtIls, "137");
    invalidateBalancesListCache();
  });

  it("dedupes in-flight fetches for the same key", async () => {
    invalidateBalancesListCache();
    const key = balancesListCacheKey({ page: 1, weekCode: "AH-136" });
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return new Promise<CustomerBalancesPayload>((resolve) => {
        setTimeout(() => resolve(emptyPayload("136")), 20);
      });
    };
    const [a, b] = await Promise.all([
      fetchBalancesListCached(key, fetcher),
      fetchBalancesListCached(key, fetcher),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.stats.totalDebtIls, "136");
    assert.equal(b.stats.totalDebtIls, "136");
    invalidateBalancesListCache();
  });

  it("timeout drops hung inflight so a retry is not stuck forever", async () => {
    invalidateBalancesListCache();
    const key = balancesListCacheKey({ page: 1, weekCode: "AH-140" });
    let calls = 0;
    const hung = () =>
      new Promise<CustomerBalancesPayload>(() => {
        calls += 1;
      });
    await assert.rejects(() => fetchBalancesListCached(key, hung, { timeoutMs: 20 }), /נמשכת זמן רב/);
    const ok = () => {
      calls += 1;
      return Promise.resolve(emptyPayload("140"));
    };
    const next = await fetchBalancesListCached(key, ok, { skipCache: true, timeoutMs: 50 });
    assert.equal(next.stats.totalDebtIls, "140");
    assert.equal(calls, 2);
    invalidateBalancesListCache();
  });

  it("invalidate clears so a later week cannot see stale data", () => {
    invalidateBalancesListCache();
    const key = balancesListCacheKey({ page: 1, weekCode: "AH-138" });
    setBalancesListCache(key, emptyPayload("138"));
    invalidateBalancesListCache();
    assert.equal(getBalancesListCache(key), null);
  });
});
