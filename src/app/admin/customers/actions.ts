"use server";

import { Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ORDER_STATUS_META } from "@/constants/order-status";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  listCustomerWorkspaceOrders,
  listCustomerWorkspacePayments,
  listCustomerWorkspaceShipments,
  listCustomersModule,
  listCustomersModuleForExport,
  type CustomerProfilePayload,
  type CustomersModuleListResult,
  type CustomerWorkspaceOrderRow,
  type CustomerWorkspacePaymentRow,
  type CustomerWorkspaceShipmentRow,
} from "@/lib/customers-module";
import { activePaidPaymentWhere, findActiveCustomerPayments } from "@/lib/payment-record-status";
import { computeOrderOpenDebtUsd } from "@/lib/order-remaining-debt";
import { loadCollectibleRemainingUsdByOrderId } from "@/lib/orders-list-collectible-remaining";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { prisma } from "@/lib/prisma";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import type { CustomersPdfScope } from "@/lib/customers-module-types";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { indexOrderCommissionBreakdowns } from "@/lib/order-commission-ssot";

function canViewCustomersModule(me: Awaited<ReturnType<typeof requireAuth>>): boolean {
  return userHasAnyPermission(me, ["view_customers", "view_customer_card", "view_reports"]);
}

export async function listCustomersModuleAction(params?: {
  page?: number;
  limit?: number;
  search?: string;
  workCountry?: string;
}): Promise<CustomersModuleListResult | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canViewCustomersModule(me)) return { ok: false, error: "אין הרשאה" };
  const wc = workCountryFromOrderSourceCountry(params?.workCountry);
  return listCustomersModule({ ...params, workCountry: wc });
}

export async function listCustomerWorkspaceOrdersAction(
  customerId?: string | null,
  workCountry?: string,
): Promise<{ ok: true; rows: CustomerWorkspaceOrderRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canViewCustomersModule(me)) return { ok: false, error: "אין הרשאה" };
  const rows = await listCustomerWorkspaceOrders(
    customerId,
    workCountryFromOrderSourceCountry(workCountry),
  );
  return { ok: true, rows };
}

export async function listCustomerWorkspacePaymentsAction(
  customerId?: string | null,
  workCountry?: string,
): Promise<{ ok: true; rows: CustomerWorkspacePaymentRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canViewCustomersModule(me)) return { ok: false, error: "אין הרשאה" };
  const rows = await listCustomerWorkspacePayments(
    customerId,
    workCountryFromOrderSourceCountry(workCountry),
  );
  return { ok: true, rows };
}

export async function listCustomerWorkspaceShipmentsAction(
  customerId?: string | null,
  workCountry?: string,
): Promise<{ ok: true; rows: CustomerWorkspaceShipmentRow[] } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canViewCustomersModule(me)) return { ok: false, error: "אין הרשאה" };
  const rows = await listCustomerWorkspaceShipments(
    customerId,
    workCountryFromOrderSourceCountry(workCountry),
  );
  return { ok: true, rows };
}

export async function getCustomerProfileAction(
  customerId: string,
): Promise<CustomerProfilePayload | null> {
  const me = await requireAuth();
  if (!canViewCustomersModule(me)) return null;

  const id = customerId.trim();
  if (!id) return null;

  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      customerCode: true,
      oldCustomerCode: true,
      displayName: true,
      nameAr: true,
      nameEn: true,
      nameHe: true,
      phone: true,
      email: true,
      country: true,
      address: true,
      city: true,
      notes: true,
      balanceUsd: true,
      isActive: true,
    },
  });
  if (!customer) return null;

  const [orders, payments, collectibleByOrder] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: id, deletedAt: null },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 2000,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        amountUsd: true,
        commissionUsd: true,
        exchangeRate: true,
        snapshotFinalDollarRate: true,
        status: true,
        totalUsd: true,
        debtWithdrawalUsd: true,
      },
    }),
    findActiveCustomerPayments({
      where: { customerId: id },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 2000,
      select: {
        id: true,
        paymentCode: true,
        paymentDate: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
        paymentMethod: true,
        notes: true,
        usdNote: true,
        ilsNote: true,
      },
    }),
    loadCollectibleRemainingUsdByOrderId([id]),
  ]);

  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  const [paySums, commissionFees] =
    orderIds.length > 0
      ? await Promise.all([
          prisma.payment.groupBy({
            by: ["orderId"],
            where: {
              orderId: { in: orderIds },
              amountUsd: { not: null },
              ...activePaidPaymentWhere,
              NOT: { businessType: { in: ["ADJUSTMENT_FEE", "CUSTOMER_CREDIT"] } },
            },
            _sum: { amountUsd: true },
          }),
          prisma.paymentAdjustmentFee.findMany({
            where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } },
            select: { orderId: true, amountUsd: true, userChoice: true },
          }),
        ])
      : [[], []];
  for (const s of paySums) {
    if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
  }
  const commissionByOrder = indexOrderCommissionBreakdowns(
    orders.map((o) => ({ id: o.id, commissionUsd: Number(o.commissionUsd ?? 0) })),
    commissionFees.map((f) => ({
      orderId: f.orderId,
      amountUsd: Number(f.amountUsd ?? 0),
      userChoice: f.userChoice,
    })),
  );

  let ordersTotal = new Prisma.Decimal(0);
  let dealsTotal = new Prisma.Decimal(0);
  let commissionTotal = new Prisma.Decimal(0);

  const orderRows = orders.map((o) => {
    const deal = o.amountUsd ?? new Prisma.Decimal(0);
    const com = o.commissionUsd ?? new Prisma.Decimal(0);
    const total = o.totalUsd ?? deal.add(com);
    const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const afterPayments = computeOrderOpenDebtUsd(Number(total), Number(paid));
    const remaining = new Prisma.Decimal(
      (
        isDebtWithdrawalOrderStatus(o.status)
          ? 0
          : (collectibleByOrder.get(o.id) ?? afterPayments)
      ).toFixed(2),
    );
    if (!isDebtWithdrawalOrderStatus(o.status)) {
      ordersTotal = ordersTotal.add(total);
      dealsTotal = dealsTotal.add(deal);
      commissionTotal = commissionTotal.add(com);
    }
    const meta = ORDER_STATUS_META[o.status];
    return {
      id: o.id,
      orderNumber: o.orderNumber?.trim() || "—",
      dateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
      amountUsd: deal.toDecimalPlaces(2, 4).toFixed(2),
      commissionUsd: (commissionByOrder.get(o.id)?.currentCommissionUsd ?? Number(com)).toFixed(2),
      commissionBaseUsd: (commissionByOrder.get(o.id)?.baseCommissionUsd ?? Number(com)).toFixed(2),
      commissionHasAdjustments: commissionByOrder.get(o.id)?.hasAdjustments === true,
      balanceUsd: remaining.toFixed(2),
      status: o.status,
      statusLabel: meta?.label ?? o.status,
    };
  });

  let paymentsTotal = new Prisma.Decimal(0);
  const paymentIds = payments.map((p) => p.id);
  const paymentCodes = payments
    .map((p) => p.paymentCode?.trim())
    .filter((code): code is string => Boolean(code));
  const paymentCommissionFees =
    paymentIds.length > 0
      ? await prisma.paymentAdjustmentFee.findMany({
          where: {
            customerId: id,
            status: { not: "CANCELLED" },
            OR: [
              { paymentId: { in: paymentIds } },
              ...(paymentCodes.length > 0 ? [{ paymentCaptureCode: { in: paymentCodes } }] : []),
            ],
          },
          select: { paymentId: true, paymentCaptureCode: true, amountUsd: true, orderId: true },
        })
      : [];
  const commissionToFeeByPayment = new Map<string, { amountUsd: number; orderId: string | null }>();
  for (const fee of paymentCommissionFees) {
    const amt = Number(fee.amountUsd ?? 0);
    const row = { amountUsd: amt, orderId: fee.orderId };
    if (fee.paymentId) {
      const prev = commissionToFeeByPayment.get(fee.paymentId);
      commissionToFeeByPayment.set(fee.paymentId, {
        amountUsd: (prev?.amountUsd ?? 0) + amt,
        orderId: fee.orderId ?? prev?.orderId ?? null,
      });
    }
    const code = fee.paymentCaptureCode?.trim();
    if (code) {
      const prev = commissionToFeeByPayment.get(`code:${code}`);
      commissionToFeeByPayment.set(`code:${code}`, {
        amountUsd: (prev?.amountUsd ?? 0) + amt,
        orderId: fee.orderId ?? prev?.orderId ?? null,
      });
    }
  }
  const paymentRows = payments.map((p) => {
    const usd = paymentRecordUsdEquivalent(p);
    paymentsTotal = paymentsTotal.add(usd);
    const hasUsd = p.amountUsd != null && p.amountUsd.gt(0);
    const hasIls = p.amountIls != null && p.amountIls.gt(0);
    const currencyLabel = hasUsd && hasIls ? "USD+ILS" : hasIls ? "ILS" : "USD";
    const method = p.paymentMethod;
    const note = (p.notes ?? p.usdNote ?? p.ilsNote ?? "").trim() || "—";
    const code = p.paymentCode?.trim() || "";
    const fee =
      commissionToFeeByPayment.get(p.id) ??
      (code ? commissionToFeeByPayment.get(`code:${code}`) : undefined);
    const feeUsd = fee?.amountUsd ?? 0;
    const feeOrder = fee?.orderId ? orders.find((o) => o.id === fee.orderId) : null;
    return {
      id: p.id,
      paymentCode: code || "—",
      dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : "—",
      amountUsd: hasUsd ? p.amountUsd!.toDecimalPlaces(2, 4).toFixed(2) : "0.00",
      amountIls: hasIls ? p.amountIls!.toDecimalPlaces(2, 4).toFixed(2) : "0.00",
      currencyLabel,
      paymentMethod: method ?? null,
      methodLabel: method ? PAYMENT_METHOD_LABELS[method] ?? method : "—",
      note,
      commissionToFeeUsd: Math.abs(feeUsd) > 0.01 ? feeUsd.toFixed(2) : null,
      commissionFeeOrderId: fee?.orderId ?? null,
      commissionFeeOrderNumber: feeOrder?.orderNumber?.trim() || null,
    };
  });

  const { getCustomerAccountBalances, customerAccountSignedUsd } = await import(
    "@/lib/customer-account-balances"
  );
  const { currentCustomerFinancialScope } = await import("@/lib/customer-financial-scope");
  const accounts = await getCustomerAccountBalances(id, currentCustomerFinancialScope());
  const signed = customerAccountSignedUsd(accounts);
  const balance = new Prisma.Decimal((-signed).toFixed(2));

  return {
    customer: {
      id: customer.id,
      code: (customer.customerCode ?? customer.oldCustomerCode ?? "").trim() || "—",
      name: primaryCustomerDisplayName(customer) || customer.displayName,
      phone: (customer.phone ?? "").trim() || "—",
      email: (customer.email ?? "").trim() || "—",
      country: (customer.country ?? "").trim() || "—",
      address: (customer.address ?? "").trim() || "—",
      city: (customer.city ?? "").trim() || "—",
      currency: "USD",
      notes: (customer.notes ?? "").trim() || "",
      isActive: customer.isActive,
    },
    kpis: {
      ordersTotalUsd: ordersTotal.toFixed(2),
      paymentsTotalUsd: paymentsTotal.toFixed(2),
      balanceUsd: balance.toFixed(2),
      openDebtUsd: accounts.openDebtUsd.toFixed(2),
      availableCreditUsd: accounts.availableCreditUsd.toFixed(2),
      commissionBalanceUsd: accounts.commissionBalanceUsd.toFixed(2),
      dealsTotalUsd: dealsTotal.toFixed(2),
      commissionTotalUsd: commissionTotal.toFixed(2),
    },
    orders: orderRows,
    payments: paymentRows,
  };
}

export type CustomersModuleExportKind = "excel" | "pdf";

const CUSTOMERS_PDF_SCOPE_LABELS: Record<CustomersPdfScope, string> = {
  current: "לקוח_נוכחי",
  all: "כל_הלקוחות",
  debt: "חובות",
  credit: "יתרות_זכות",
};

function customersExportFilename(scope: CustomersPdfScope, ext: "html" | "xlsx"): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `customers_${CUSTOMERS_PDF_SCOPE_LABELS[scope]}_${stamp}.${ext}`;
}

export async function exportCustomersModuleListAction(params: {
  scope: CustomersPdfScope;
  customerId?: string | null;
  workCountry?: string;
  kind?: CustomersModuleExportKind;
}): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!canViewCustomersModule(me)) return { ok: false, error: "אין הרשאה" };

    const scope = params.scope;
    if (scope === "current" && !params.customerId?.trim()) {
      return { ok: false, error: "יש לבחור לקוח" };
    }

    const wc = workCountryFromOrderSourceCountry(params.workCountry);
    const rows = await listCustomersModuleForExport({
      scope,
      customerId: params.customerId,
      workCountry: wc,
    });
    if (!rows.length) return { ok: false, error: "אין נתונים לייצוא" };

    const headers = ['שם לקוח', "קוד לקוח", 'סה"כ הזמנות ($)', 'סה"כ תשלומים ($)', "יתרה ($)"];
    const data = rows.map((r) => [
      r.name,
      r.code,
      formatUsdDisplay(parseMoneyStringOrZero(r.ordersTotalUsd)),
      formatUsdDisplay(parseMoneyStringOrZero(r.paymentsTotalUsd)),
      formatUsdDisplay(parseMoneyStringOrZero(r.balanceUsd)),
    ]);

    let ordersSum = 0;
    let paymentsSum = 0;
    let balanceSum = 0;
    for (const r of rows) {
      ordersSum += parseMoneyStringOrZero(r.ordersTotalUsd);
      paymentsSum += parseMoneyStringOrZero(r.paymentsTotalUsd);
      balanceSum += parseMoneyStringOrZero(r.balanceUsd);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const scopeTitle =
      scope === "current"
        ? "רשימת לקוחות — לקוח נוכחי"
        : scope === "debt"
          ? "רשימת לקוחות — חובות בלבד"
          : scope === "credit"
            ? "רשימת לקוחות — יתרות זכות בלבד"
            : "רשימת לקוחות — כל הלקוחות";

    const kind = params.kind ?? "pdf";

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`${scopeTitle} · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: customersExportFilename(scope, "xlsx"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildAtlasExportHtml } = await import("@/lib/atlas-export-html");
    const html = buildAtlasExportHtml({
      title: `${scopeTitle} · ${stamp}`,
      reportKind: "balances",
      headers,
      rows: data,
      meta: { extraMeta: `הופק: ${stamp} · ${rows.length} לקוחות` },
      footer: {
        ordersTotalUsd: formatUsdDisplay(ordersSum),
        paymentsTotalUsd: formatUsdDisplay(paymentsSum),
        balanceUsd: formatUsdDisplay(balanceSum),
      },
    });

    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: customersExportFilename(scope, "html"),
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}

