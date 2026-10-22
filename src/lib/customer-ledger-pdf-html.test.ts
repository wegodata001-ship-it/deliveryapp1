import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/lib/customer-account-ledger";
import { applyManualLedgerSelection } from "@/lib/customer-ledger-manual-pdf";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";

function row(partial: Partial<CustomerLedgerRow> & Pick<CustomerLedgerRow, "id">): CustomerLedgerRow {
  return {
    dateYmd: "2026-06-10",
    kind: "ORDER",
    typeLabel: "הזמנה",
    chargeUsd: "0.00",
    paymentUsd: "0.00",
    balanceUsd: "0.00",
    document: "TR-126-0004",
    orderId: null,
    paymentId: null,
    ...partial,
  };
}

const ledger: CustomerLedgerPayload = {
  rows: [
    row({ id: "o1", dateYmd: "2026-06-01", document: "TR-1", typeLabel: "הזמנה", chargeUsd: "1000.00", balanceUsd: "1000.00" }),
    row({
      id: "p1",
      dateYmd: "2026-06-02",
      kind: "PAYMENT",
      typeLabel: "תשלום",
      document: "TR-P-1",
      paymentUsd: "300.00",
      balanceUsd: "700.00",
    }),
    row({ id: "w1", dateYmd: "2026-06-03", document: "TR-2", typeLabel: "משיכה מחוב", chargeUsd: "1212.00", balanceUsd: "1912.00", isDebtWithdrawal: true }),
  ],
  totalChargesUsd: "2212.00",
  totalPaymentsUsd: "300.00",
  totalWithdrawalsUsd: "1212.00",
  balanceUsd: "1912.00",
  openDebtUsd: "1912.00",
  availableCreditUsd: "40.00",
  commissionBalanceUsd: "62.50",
};

const font = { family: "Noto Sans Hebrew", mimeType: "font/ttf", base64: "AA==" };
const meta = {
  displayName: "עלי",
  customerCode: "110",
  phone: null,
  email: null,
  fromYmd: "",
  toYmd: "",
};

describe("customer ledger PDF HTML", () => {
  it("is a data-built RTL document with the required header, table, and summary", () => {
    const html = buildCustomerLedgerPdfHtml({ meta, ledger, font });
    assert.match(html, /dir="rtl"/);
    assert.match(html, /כרטסת לקוח/);
    assert.match(html, /עלי/);
    assert.match(html, /110/);
    assert.match(html, /תאריך הפקה/);
    assert.match(html, /<th class="col-money">חוב פתוח אחרי<\/th>/);
    assert.match(html, /<th class="col-money">נשאר להזמנה<\/th>/);
    assert.match(html, /<th class="col-money">חיוב<\/th>/);
    assert.match(html, /התקבל/);
    assert.match(html, /סה״כ הזמנות/);
    assert.match(html, /סה״כ תשלומים/);
    assert.match(html, /סה״כ משיכות מחוב/);
    assert.match(html, /יתרה סופית/);
    assert.match(html, /יתרת זכות/);
    assert.match(html, /יתרת עמלות/);
    assert.match(html, /TR-1/);
    assert.match(html, /TR-P-1/);
    assert.match(html, /משיכה מחוב/);
    assert.doesNotMatch(html, /adm-btn|scrollbar|PDF ידני|נקה/);
  });

  it("keeps historical running balance on a manual selection", () => {
    const selected = applyManualLedgerSelection(ledger, ["w1", "p1"]);
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    const html = buildCustomerLedgerPdfHtml({
      meta,
      ledger: selected.ledger,
      font,
      selection: selected.summary,
    });
    assert.match(html, /TR-P-1/);
    assert.match(html, /TR-2/);
    assert.doesNotMatch(html, /TR-1/);
    assert.match(html, /1,912/);
    assert.match(html, /יתרה לאחר התנועה האחרונה שנבחרה/);
    assert.equal(selected.ledger.rows[1]?.balanceUsd, "1912.00");
  });
});
