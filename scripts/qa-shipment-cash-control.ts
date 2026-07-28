/**
 * QA לוגיקת בקרת קופה – דמי משלוח (ללא DB).
 * הרצה: npx tsx scripts/qa-shipment-cash-control.ts
 */
import {
  computeRowRemaining,
  computeShipmentCashKpis,
  deriveFeePaymentStatus,
} from "../src/app/admin/shipments/cash-control/ssot";
import {
  buildGroupSummaries,
  filterRowsForKpiDrill,
  rowPaymentTone,
} from "../src/app/admin/shipments/cash-control/view-helpers";
import type { ShipmentCashControlRow } from "../src/app/admin/shipments/cash-control/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function row(partial: Partial<ShipmentCashControlRow> & { id: string }): ShipmentCashControlRow {
  const deliveryFeeIls = partial.deliveryFeeIls ?? 100;
  const paidAmountIls = partial.paidAmountIls ?? 0;
  const remainingFeeIls = computeRowRemaining(deliveryFeeIls, paidAmountIls);
  return {
    id: partial.id,
    batchId: "b1",
    batchNumber: "B1",
    shipmentLabel: partial.shipmentLabel ?? partial.id,
    weekCode: "2026-W30",
    shippingDate: "2026-07-20",
    arrivalDate: "2026-07-21",
    customerName: null,
    courierId: partial.courierId ?? "c1",
    courierName: partial.courierName ?? "שליח א",
    zoneId: partial.zoneId ?? "z1",
    zoneName: partial.zoneName ?? "צפון",
    country: null,
    boxes: partial.boxes ?? 2,
    deliveryFeeIls,
    paidAmountIls,
    remainingFeeIls,
    paymentStatus: deriveFeePaymentStatus(deliveryFeeIls, paidAmountIls),
    status: "ARRIVED",
    notes: null,
    payments: [],
  };
}

let passed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

check("קליטה חלקית → PARTIAL + כתום", () => {
  const r = row({ id: "1", deliveryFeeIls: 100, paidAmountIls: 40 });
  assert(r.paymentStatus === "PARTIAL", "status");
  assert(rowPaymentTone(r) === "partial", "tone");
  assert(Math.abs(r.remainingFeeIls - 60) < 0.001, "remaining");
});

check("מספר קליטות לאותו משלוח", () => {
  const fee = 100;
  const paid = 30 + 25 + 45;
  assert(deriveFeePaymentStatus(fee, paid) === "PAID", "paid");
  assert(computeRowRemaining(fee, paid) === 0, "zero remaining");
});

check("מחיקת/עריכת קליטה משנה יתרה", () => {
  const afterDelete = computeRowRemaining(100, 30);
  assert(afterDelete === 70, "after delete");
  assert(deriveFeePaymentStatus(100, 30) === "PARTIAL", "partial again");
});

check("ללא דמי משלוח → אפור", () => {
  const r = row({ id: "0", deliveryFeeIls: 0, paidAmountIls: 0 });
  assert(rowPaymentTone(r) === "none", "none tone");
});

check("לא נקלט כלל → אדום", () => {
  const r = row({ id: "u", deliveryFeeIls: 80, paidAmountIls: 0 });
  assert(rowPaymentTone(r) === "unpaid", "unpaid");
});

check("שולם במלואו → ירוק", () => {
  const r = row({ id: "p", deliveryFeeIls: 50, paidAmountIls: 50 });
  assert(rowPaymentTone(r) === "paid", "paid");
});

check("Drill KPIs", () => {
  const rows = [
    row({ id: "a", paidAmountIls: 100 }),
    row({ id: "b", paidAmountIls: 20 }),
    row({ id: "c", paidAmountIls: 0 }),
  ];
  assert(filterRowsForKpiDrill(rows, "collected").length === 2, "collected");
  assert(filterRowsForKpiDrill(rows, "remaining").length === 2, "remaining");
  assert(filterRowsForKpiDrill(rows, "fees").length === 3, "fees");
  assert(filterRowsForKpiDrill(rows, "packages").length === 3, "packages");
});

check("קיבוץ לפי שליח / אזור", () => {
  const rows = [
    row({ id: "1", courierId: "c1", courierName: "א", zoneId: "z1", zoneName: "צפון", paidAmountIls: 50 }),
    row({ id: "2", courierId: "c1", courierName: "א", zoneId: "z2", zoneName: "דרום", paidAmountIls: 0 }),
    row({ id: "3", courierId: "c2", courierName: "ב", zoneId: "z1", zoneName: "צפון", paidAmountIls: 100 }),
  ];
  const byCourier = buildGroupSummaries(rows, "courier");
  assert(byCourier.length === 2, "2 couriers");
  const a = byCourier.find((g) => g.key === "c1")!;
  assert(a.shipmentCount === 2, "courier shipments");
  assert(Math.abs(a.collectedIls - 50) < 0.001, "courier collected");
  const byZone = buildGroupSummaries(rows, "zone");
  assert(byZone.length === 2, "2 zones");
});

check("KPI SSOT במעבר יחיד", () => {
  const rows = [
    row({ id: "1", deliveryFeeIls: 100, paidAmountIls: 40, boxes: 3 }),
    row({ id: "2", deliveryFeeIls: 50, paidAmountIls: 50, boxes: 1 }),
  ];
  const k = computeShipmentCashKpis(rows, 15);
  assert(Math.abs(k.totalFeeIls - 150) < 0.001, "fees");
  assert(Math.abs(k.collectedIls - 90) < 0.001, "collected");
  assert(Math.abs(k.remainingIls - 60) < 0.001, "remaining");
  assert(k.expensesIls === 15, "expenses separate");
  assert(k.shipmentCount === 2, "count");
  assert(k.packagesCount === 4, "packages");
});

console.log(`\nQA shipment cash control: ${passed} checks passed`);
