import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateFlowIntakesByDay,
  computePaymentsTotalReceivedIls,
  paymentRowReceivedIls,
} from "@/lib/flow-control/flow-calculation-service";

function pay(partial: {
  id: string;
  paymentCode?: string | null;
  amountIls?: number | null;
  amountUsd?: number | null;
  exchangeRate?: number | null;
  paymentMethod?: string | null;
  usdPaymentMethod?: string | null;
  ilsPaymentMethod?: string | null;
  methodAllocations?: Array<{ method: string; currency: string; sourceAmount: number }>;
  totalIlsWithoutVat?: number | null;
}) {
  return {
    id: partial.id,
    paymentCode: partial.paymentCode ?? null,
    amountIls: partial.amountIls != null ? { toString: () => String(partial.amountIls) } : null,
    amountUsd: partial.amountUsd != null ? { toString: () => String(partial.amountUsd) } : null,
    exchangeRate:
      partial.exchangeRate != null ? { toString: () => String(partial.exchangeRate) } : null,
    paymentMethod: partial.paymentMethod ?? "CASH",
    usdPaymentMethod: partial.usdPaymentMethod ?? null,
    ilsPaymentMethod: partial.ilsPaymentMethod ?? null,
    totalIlsWithoutVat:
      partial.totalIlsWithoutVat != null
        ? { toString: () => String(partial.totalIlsWithoutVat) }
        : null,
    methodAllocations: partial.methodAllocations?.map((a) => ({
      method: a.method,
      currency: a.currency,
      sourceAmount: { toString: () => String(a.sourceAmount) },
    })),
    paymentDate: new Date("2026-07-20T10:00:00+03:00"),
    createdAt: new Date("2026-07-20T10:00:00+03:00"),
  };
}

describe("סה״כ התקבל מקליטות תשלום בלבד", () => {
  it("סוכם מזומן $ לפי שער הקליטה", () => {
    const p = pay({
      id: "1",
      paymentCode: "P-1",
      amountUsd: 100,
      exchangeRate: 3.5,
      usdPaymentMethod: "CASH",
      methodAllocations: [{ method: "CASH", currency: "USD", sourceAmount: 100 }],
    });
    assert.equal(paymentRowReceivedIls(p), 350);
    assert.equal(computePaymentsTotalReceivedIls([p]), 350);
  });

  it("סוכם מזומן ₪ + מזומן $ מ־methodAllocations", () => {
    const p = pay({
      id: "1",
      paymentCode: "P-1",
      amountIls: 500,
      amountUsd: 60,
      exchangeRate: 3.5,
      ilsPaymentMethod: "BANK_TRANSFER",
      usdPaymentMethod: "CASH",
      methodAllocations: [
        { method: "CASH", currency: "USD", sourceAmount: 100 },
        { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: 500 },
      ],
    });
    assert.equal(computePaymentsTotalReceivedIls([p]), 850);
  });

  it("לא סופר פעמיים שורות FIFO אחיות כשיש methodAllocations על הראשי", () => {
    const primary = pay({
      id: "1",
      paymentCode: "CAP-9",
      amountUsd: 60,
      exchangeRate: 3.5,
      usdPaymentMethod: "CASH",
      methodAllocations: [{ method: "CASH", currency: "USD", sourceAmount: 100 }],
    });
    const sibling = pay({
      id: "2",
      paymentCode: "CAP-9",
      amountUsd: 40,
      exchangeRate: 3.5,
      usdPaymentMethod: "CASH",
    });
    assert.equal(computePaymentsTotalReceivedIls([primary, sibling]), 350);

    const byDay = aggregateFlowIntakesByDay([primary, sibling], () => "2026-07-20");
    const day = byDay.get("2026-07-20")!;
    assert.equal(day.CASH_USD, 100);
  });

  it("ללא allocations — סוכם amountIls + amountUsd×שער לכל שורה", () => {
    const a = pay({
      id: "1",
      paymentCode: null,
      amountIls: 200,
      ilsPaymentMethod: "CASH",
      exchangeRate: 3.5,
    });
    const b = pay({
      id: "2",
      paymentCode: null,
      amountUsd: 10,
      usdPaymentMethod: "CASH",
      exchangeRate: 3.5,
    });
    assert.equal(computePaymentsTotalReceivedIls([a, b]), 235);
  });
});
