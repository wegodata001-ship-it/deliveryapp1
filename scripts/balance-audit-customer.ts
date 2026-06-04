/**
 * Audit יתרה ללקוח לפי customerCode (ברירת מחדל 152)
 * Usage: npx tsx scripts/balance-audit-customer.ts [customerCode]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { calculateCustomerBalance } from "../src/lib/customer-balance-calculator";
import { OS } from "../src/lib/order-status-slugs";
import {
  isDebtWithdrawalOrderStatus,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
  orderUsdTotalValue,
} from "../src/lib/debt-withdrawal-order";
import { orderLedgerBalanceUsd } from "../src/lib/payment-intake";

const CODE = (process.argv[2] ?? "152").trim();
const EPS = 0.02;

function n(d: Prisma.Decimal | null | undefined): number {
  if (d == null) return 0;
  return Number(d.toFixed(4));
}

function fmt(v: number): string {
  return v.toFixed(2);
}

async function main() {
  const cust = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      OR: [{ customerCode: CODE }, { oldCustomerCode: CODE }],
    },
    select: { id: true, customerCode: true, oldCustomerCode: true, displayName: true },
  });

  if (!cust) {
    console.error(`Customer code ${CODE} not found`);
    process.exit(1);
  }

  const cid = cust.id;
  console.log(`\n=== BALANCE AUDIT customerCode=${CODE} ===`);
  console.log(`customerId=${cid}`);
  console.log(`name=${cust.displayName}`);
  console.log(`customerCode=${cust.customerCode} old=${cust.oldCustomerCode}\n`);

  const orders = await prisma.order.findMany({
    where: { customerId: cid, deletedAt: null },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      debtWithdrawalUsd: true,
    },
  });

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, number>();
  if (orderIds.length) {
    const sums = await prisma.payment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, amountUsd: { not: null } },
      _sum: { amountUsd: true },
    });
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, n(s._sum.amountUsd));
    }
  }

  const payments = await prisma.payment.findMany({
    where: { customerId: cid, isPaid: true },
    orderBy: { paymentDate: "asc" },
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      amountUsd: true,
      amountIls: true,
      exchangeRate: true,
    },
  });

  console.log("--- Orders ---");
  let sumTotalUsd = 0;
  let sumRemainingOrdersList = 0;
  let sumRemainingPaymentIntake = 0;
  const debtWithdrawals: Array<{ orderNumber: string | null; amountUsd: number }> = [];

  for (const o of orders) {
    const totalUsd = orderUsdTotalValue(o);
    const paidUsd = paidByOrder.get(o.id) ?? 0;
    const debtW = n(o.debtWithdrawalUsd);
    const paidOrdersList = paidUsd + (isDebtWithdrawalOrderStatus(o.status) ? debtW : 0);
    const remainingOrdersList = totalUsd - paidOrdersList;

    const remIntake = totalUsd - paidUsd;
    sumRemainingPaymentIntake += remIntake > EPS ? remIntake : 0;

    if (!isDebtWithdrawalOrderStatus(o.status)) {
      sumTotalUsd += totalUsd;
      sumRemainingOrdersList += remainingOrdersList > EPS ? remainingOrdersList : 0;
    } else {
      debtWithdrawals.push({
        orderNumber: o.orderNumber,
        amountUsd: orderCustomerCreditUsd(o),
      });
    }

    console.log(
      [
        o.orderNumber ?? "—",
        o.status,
        `totalUsd=${fmt(totalUsd)}`,
        `paidUsd=${fmt(paidUsd)}`,
        `remainingUsd=${fmt(totalUsd - paidUsd)}`,
        isDebtWithdrawalOrderStatus(o.status) ? `[withdrawal credit=${fmt(orderCustomerCreditUsd(o))}]` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  console.log("\n--- Payments (isPaid=true) ---");
  let sumPaymentsUsd = 0;
  for (const p of payments) {
    let amt = n(p.amountUsd);
    if (amt <= 0 && p.amountIls && p.exchangeRate && n(p.exchangeRate) > 0) {
      amt = n(p.amountIls) / n(p.exchangeRate);
    }
    sumPaymentsUsd += amt;
    console.log(`${p.paymentCode ?? p.id.slice(0, 8)} | orderId=${p.orderId ?? "—"} | amountUsd=${fmt(amt)}`);
  }

  console.log("\n--- Debt Withdrawals ---");
  let sumDebtWithdrawals = 0;
  for (const w of debtWithdrawals) {
    sumDebtWithdrawals += w.amountUsd;
    console.log(`${w.orderNumber ?? "—"} | amountUsd=${fmt(w.amountUsd)}`);
  }
  if (debtWithdrawals.length === 0) console.log("(none)");

  const A = sumTotalUsd;
  const B = sumRemainingOrdersList;
  const C = sumPaymentsUsd;
  const D = sumDebtWithdrawals;

  const calc = await calculateCustomerBalance(cid, {});

  const apiBalanceRoute = n(
    (
      await prisma.order.aggregate({
        where: { customerId: cid, deletedAt: null },
        _sum: { totalUsd: true },
      })
    )._sum.totalUsd,
  ) -
    n(
      (
        await prisma.payment.aggregate({
          where: { customerId: cid, isPaid: true },
          _sum: { amountUsd: true },
        })
      )._sum.amountUsd,
    );

  const paymentIntakeFooterRemaining = sumRemainingPaymentIntake;

  let ordersListSumBalance = 0;
  for (const o of orders) {
    const total = orderUsdTotalValue(o);
    const rawPaid = paidByOrder.get(o.id) ?? 0;
    const debtWithdrawal = n(o.debtWithdrawalUsd);
    const paid = rawPaid + (isDebtWithdrawalOrderStatus(o.status) ? debtWithdrawal : 0);
    const balanceUsd = total - paid;
    if (balanceUsd > EPS) ordersListSumBalance += balanceUsd;
  }

  console.log("\n[BALANCE AUDIT]");
  console.log(`customerId=${cid}`);
  console.log(`customerCode=${CODE}`);
  console.log("");
  console.log("--- Raw sums (user formulas) ---");
  console.log(`A SUM(order.totalUsd) [excl. withdrawals]=${fmt(A)}`);
  console.log(`B SUM(order.remainingUsd) [orders-list style]=${fmt(B)}`);
  console.log(`C SUM(payments.amountUsd)=${fmt(C)}`);
  console.log(`D SUM(debtWithdrawals.amountUsd)=${fmt(D)}`);
  console.log(`A - C - D (canonical)=${fmt(A - C - D)}`);
  console.log("");
  console.log("[BALANCE AUDIT] per screen");
  console.log("");
  console.log("Customer Balance Report / Balances page:");
  console.log(`  function: calculateCustomerBalances → shared.balance`);
  console.log(`  totalOrders=${fmt(n(calc.totalOrders))}`);
  console.log(`  totalPaid=${fmt(n(calc.totalPayments))}`);
  console.log(`  totalDebtWithdrawals=${fmt(n(calc.totalWithdrawals))}`);
  console.log(`  remainingBalance=${fmt(n(calc.balance))}`);
  console.log("");
  console.log("Payment Intake Screen:");
  console.log(`  function: fetchPaymentIntakeCustomerOrdersAction + orderLedgerBalanceUsd footer`);
  console.log(`  totalOrders(sum totalAmountUsd on matched)=${fmt(orders.reduce((s, o) => s + orderUsdTotalValue(o), 0))}`);
  console.log(`  totalPaid(sum dbPaidUsd per order)=${fmt([...paidByOrder.values()].reduce((a, b) => a + b, 0))}`);
  console.log(`  totalDebtWithdrawals(NOT in intake paid)=${fmt(0)}`);
  console.log(`  remainingBalance(open only)=${fmt(paymentIntakeFooterRemaining)}`);
  console.log("");
  console.log("Orders List:");
  console.log(`  function: orders-list-data balanceUsd=total-(paid+debtWithdrawalUsd)`);
  console.log(`  remainingBalance(sum positive row balances)=${fmt(ordersListSumBalance)}`);
  console.log("");
  console.log("API /api/customers/balance (OrderCreatePanel extras):");
  console.log(`  function: aggregate totalUsd - aggregate amountUsd (NO withdrawals)`);
  console.log(`  remainingBalance=${fmt(apiBalanceRoute)}`);
  console.log("");
  console.log("--- MISMATCH matrix ---");
  const screens = [
    { name: "Customer Balance Report", val: n(calc.balance) },
    { name: "Payment Intake", val: paymentIntakeFooterRemaining },
    { name: "Orders List (sum rows)", val: ordersListSumBalance },
    { name: "API customers/balance", val: apiBalanceRoute },
  ];
  const ref = n(calc.balance);
  for (const s of screens) {
    const diff = Math.round((s.val - ref) * 100) / 100;
    if (Math.abs(diff) > EPS) {
      console.log(`✗ ${s.name}: ${fmt(s.val)} (Δ ${diff >= 0 ? "+" : ""}${fmt(diff)} vs canonical ${fmt(ref)})`);
    } else {
      console.log(`✓ ${s.name}: ${fmt(s.val)}`);
    }
  }

  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
