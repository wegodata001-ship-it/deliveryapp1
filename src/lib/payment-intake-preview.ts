/**
 * Preview בלבד לקליטת תשלום — לא כותב SSOT ולא מקצה להזמנות.
 * signedRemainingUsd = openDebt − draftPayment (שלילי = תשלום יתר, תצוגה בלבד).
 * remainingDebt = max(0, signedRemainingUsd) — חוב פתוח אחרי התשלום.
 * חוב וזכות כבר מקוזזים ב-SSOT — אין קיזוז זכות נוסף.
 * Fees לא נכנסות לחוב.
 */
import {
  formatCustomerNetBalanceUsd,
  normalizeExclusiveCustomerBooks,
} from "@/lib/customer-account-balances-shared";
import { parseMoneyStringOrZero } from "@/lib/money-format";
import { customerBooksAfterPaymentApply } from "@/lib/payment-intake-customer-debt";
import {
  computeOrderOpenDebtUsd,
  derivePaymentBalanceDisplay,
  resolveOrderTotalUsd,
  roundOrderMoney2,
  type PaymentBalanceDisplay,
} from "@/lib/order-remaining-debt";
import { convertDebtUsdToIlsIncludingVat } from "@/lib/usd-balance-ils-vat";

/**
 * יתרת זכות זמינה לקליטה בשבוע שנבחר.
 * אם יש חוב שבועי לגבייה — הזכות כבר קוזזה ב-FIFO collectible remaining.
 * אסור להציג gross CUSTOMER_CREDIT כיתרת זכות קיימת ליד החוב השבועי.
 */
export function availableCreditForWeekScopedPayable(params: {
  weekScopedDebtUsd: number;
  ssotAvailableCreditUsd: number;
}): number {
  const weekDebt = roundOrderMoney2(Math.max(0, params.weekScopedDebtUsd));
  const ssotCredit = roundOrderMoney2(Math.max(0, params.ssotAvailableCreditUsd));
  if (weekDebt > 0.01) return 0;
  return ssotCredit;
}

export type PaymentPreviewFinancialState = {
  openDebtUsd: number | null;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
};

export type PaymentPreviewOrder = {
  totalAmountUsd?: number;
  totalUsd?: number;
  amountUsd?: number;
  commissionUsd?: number;
  dbPaidUsd?: number;
  collectibleRemainingUsd?: number;
  isDebtWithdrawal?: boolean;
  status?: string;
};

type PaymentPreviewOrderSource = {
  totalAmountUsd?: string | number | null;
  totalUsd?: string | number | null;
  amountUsd?: string | number | null;
  commissionUsd?: string | number | null;
  dbPaidUsd?: string | number | null;
  dbRemainingUsd?: string | number | null;
  collectibleRemainingUsd?: string | number | null;
  isDebtWithdrawal?: boolean;
  status?: string;
};

function previewMoneyUsd(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return parseMoneyStringOrZero(value);
}

/** Intake rows (string money) → preview orders (finite numbers). */
export function toPaymentPreviewOrders(
  rows: readonly PaymentPreviewOrderSource[],
): PaymentPreviewOrder[] {
  return rows.map((order) => ({
    totalAmountUsd: previewMoneyUsd(order.totalAmountUsd),
    totalUsd: previewMoneyUsd(order.totalUsd),
    amountUsd: previewMoneyUsd(order.amountUsd),
    commissionUsd: previewMoneyUsd(order.commissionUsd),
    dbPaidUsd: previewMoneyUsd(order.dbPaidUsd),
    collectibleRemainingUsd: previewMoneyUsd(
      order.collectibleRemainingUsd ?? order.dbRemainingUsd,
    ),
    isDebtWithdrawal: order.isDebtWithdrawal === true,
    status: order.status,
  }));
}

export type PaymentIntakePreview = {
  debtBefore: number;
  selectedOrdersRemaining: number;
  existingCredit: number;
  draftPaymentTotal: number;
  /** חתום: חיובי=חוב נשאר, 0=אין יתרה, שלילי=יתרת זכות (preview בלבד) */
  signedRemainingUsd: number;
  remainingDebt: number;
  projectedCredit: number;
  projectedOverpayment: number;
  fees: number;
};

export function sumOpenOrderRemainingUsd(orders: readonly PaymentPreviewOrder[]): number {
  let sum = 0;
  for (const order of orders) {
    if (order.isDebtWithdrawal || order.status === "DEBT_WITHDRAWAL") continue;
    if (order.collectibleRemainingUsd != null && Number.isFinite(order.collectibleRemainingUsd)) {
      sum += Math.max(0, order.collectibleRemainingUsd);
      continue;
    }
    const total = resolveOrderTotalUsd({
      totalUsd: order.totalAmountUsd ?? order.totalUsd,
      amountUsd: order.amountUsd,
      commissionUsd: order.commissionUsd,
    });
    sum += computeOrderOpenDebtUsd(total, Number(order.dbPaidUsd) || 0);
  }
  return roundOrderMoney2(sum);
}

function money2(n: number): number {
  return roundOrderMoney2(Number.isFinite(n) ? n : 0);
}

/** Preview בלבד — חוב פיננסי נשאר clamped; תצוגת הכרטיס שומרת את הסימן. */
export function splitSignedPaymentRemaining(signedRemainingUsd: number): {
  signedRemainingUsd: number;
  remainingDebtUsd: number;
  overpaymentUsd: number;
} {
  const signed = money2(signedRemainingUsd);
  return {
    signedRemainingUsd: signed,
    remainingDebtUsd: money2(Math.max(0, signed)),
    overpaymentUsd: money2(Math.max(0, -signed)),
  };
}

/**
 * כרטיס «נשאר לתשלום» — אסור להשתמש ב-remainingDebt הכמוס כשיש עודף.
 * overpaymentUsd ו-signedRemaining חייבים לבוא מאותו preview.
 */
export function remainingToPayCardDisplayFromPreview(
  preview: Pick<PaymentIntakePreview, "signedRemainingUsd" | "projectedOverpayment" | "remainingDebt">,
  exchangeRate: number,
): PaymentBalanceDisplay {
  const split = splitSignedPaymentRemaining(preview.signedRemainingUsd);
  const overpaymentUsd = money2(
    preview.projectedOverpayment > 0 ? preview.projectedOverpayment : split.overpaymentUsd,
  );
  if (overpaymentUsd > 0.01) {
    return derivePaymentBalanceDisplay(-overpaymentUsd, exchangeRate);
  }
  if (preview.remainingDebt > 0.01) {
    return derivePaymentBalanceDisplay(preview.remainingDebt, exchangeRate);
  }
  return derivePaymentBalanceDisplay(0, exchangeRate);
}

/**
 * כרטיס תחתון: אם יש עודף — תמיד +overpayment, גם כש-remainingDebt הוצג כ-$0.
 * אותו overpaymentUsd משמש גם להודעת «עודף מהתשלום הנוכחי».
 */
export function remainingToPayCardDisplayFromOverpayment(
  overpaymentUsd: number,
  fallback: PaymentBalanceDisplay | null,
  exchangeRate: number,
): PaymentBalanceDisplay {
  const surplus = money2(overpaymentUsd);
  if (surplus > 0.01) {
    return derivePaymentBalanceDisplay(-surplus, exchangeRate);
  }
  return (
    fallback ??
    derivePaymentBalanceDisplay(0, exchangeRate)
  );
}

/** Preview only — min(SSOT credit, eligible remaining). 0 when unused or nothing to cover. */
export function computePendingCreditApplyUsd(input: {
  availableCreditUsd: number;
  eligibleAmountToPayUsd: number;
  useExistingCredit: boolean;
}): number {
  if (!input.useExistingCredit) return 0;
  const credit = money2(Math.max(0, input.availableCreditUsd));
  const eligible = money2(Math.max(0, input.eligibleAmountToPayUsd));
  return money2(Math.min(credit, eligible));
}

/**
 * חוב לשבוע הקליטה:
 * כשיש יקום הזמנות זכאי — SUM(יתרות הזמנות) גובר על CURRENT SSOT.
 * בלי יקום הזמנות — נשארים עם SSOT (בדיקות / כותרת).
 */
export function resolvePaymentPreviewCollectibleDebt(input: {
  customerOpenDebtUsd: number | null;
  selectedOrdersRemainingUsd: number;
  ssotLoaded: boolean;
  hasEligibleOrderSet?: boolean;
}): number {
  const ordersRemaining = money2(Math.max(0, input.selectedOrdersRemainingUsd));
  if (input.hasEligibleOrderSet) return ordersRemaining;
  if (!input.ssotLoaded || input.customerOpenDebtUsd == null) return ordersRemaining;
  return money2(Math.max(0, input.customerOpenDebtUsd));
}

export function buildPaymentPreview(input: {
  financialState: PaymentPreviewFinancialState;
  draftPaymentUsd: number;
  selectedOrders?: readonly PaymentPreviewOrder[];
  selectedOrdersRemainingUsd?: number;
  /** קיזוז יתרת זכות קיימת — רק אם המשתמש/המנוע הפעיל זאת */
  useExistingCredit?: boolean;
}): PaymentIntakePreview {
  const ssotLoaded = input.financialState.openDebtUsd != null;
  const fees = money2(input.financialState.commissionBalanceUsd);
  const hasEligibleOrderSet =
    input.selectedOrdersRemainingUsd != null || input.selectedOrders != null;
  const selectedOrdersRemaining =
    input.selectedOrdersRemainingUsd != null
      ? money2(Math.max(0, input.selectedOrdersRemainingUsd))
      : sumOpenOrderRemainingUsd(input.selectedOrders ?? []);
  const draftPaymentTotal = money2(Math.max(0, input.draftPaymentUsd));
  const rawDebt = resolvePaymentPreviewCollectibleDebt({
    customerOpenDebtUsd: input.financialState.openDebtUsd,
    selectedOrdersRemainingUsd: selectedOrdersRemaining,
    ssotLoaded,
    hasEligibleOrderSet,
  });
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: rawDebt,
    availableCreditUsd: input.financialState.availableCreditUsd,
  });
  const debtBefore = books.openDebtUsd;
  const existingCredit = books.availableCreditUsd;
  const collectible = debtBefore;
  const split = splitSignedPaymentRemaining(collectible - draftPaymentTotal);
  const signedRemainingUsd = split.signedRemainingUsd;
  const remainingDebt = split.remainingDebtUsd;
  const leftoverDraft = split.overpaymentUsd;
  const projectedOverpayment = leftoverDraft;
  const projectedCredit = money2(existingCredit + leftoverDraft);

  return {
    debtBefore,
    selectedOrdersRemaining,
    existingCredit,
    draftPaymentTotal,
    signedRemainingUsd,
    remainingDebt,
    projectedCredit,
    projectedOverpayment,
    fees,
  };
}

export type PaymentIntakeSurplusDestination = "credit" | "commission" | "forfeit" | "none";

export type PaymentIntakeFinalBalance = {
  openDebtAfter: number;
  availableCreditAfter: number;
  /** +זכות / 0 מאוזן / −חוב — אותו netBalanceUsd של יתרות / כרטסת */
  signedBalanceUsd: number;
  surplusPendingUsd: number;
  state: "credit" | "cleared" | "debt";
  title: "יתרה";
  statusLabel: "יתרת זכות" | "מאוזן" | "חוב לתשלום" | "חוב נסגר";
};

/**
 * יתרה סופית לקליטה — ספרי לקוח אחרי התשלום בטופס ויעד העודף.
 * לא received−debt. לא MAX(0, debt−pay) בלי זכות.
 */
export function paymentIntakeFinalCustomerBalance(input: {
  debtBefore: number;
  existingCredit: number;
  draftPaymentUsd: number;
  surplusDestination?: PaymentIntakeSurplusDestination | null;
}): PaymentIntakeFinalBalance {
  const dest = input.surplusDestination ?? "none";
  const draft = money2(Math.max(0, input.draftPaymentUsd));
  const debtBefore = money2(Math.max(0, input.debtBefore));
  const surplusAmount = money2(Math.max(0, draft - debtBefore));
  const destChosen = dest === "credit" || dest === "commission" || dest === "forfeit";
  const surplusPendingUsd = !destChosen && surplusAmount > 0.01 ? surplusAmount : 0;
  const books = customerBooksAfterPaymentApply({
    openDebtUsd: debtBefore,
    availableCreditUsd: input.existingCredit,
    applyUsd: draft,
    surplusToCredit: dest === "credit",
  });
  const exclusive = normalizeExclusiveCustomerBooks(books);
  const signed = exclusive.netBalanceUsd;
  if (signed > 0.01) {
    return {
      openDebtAfter: exclusive.openDebtUsd,
      availableCreditAfter: exclusive.availableCreditUsd,
      signedBalanceUsd: signed,
      surplusPendingUsd,
      state: "credit",
      title: "יתרה",
      statusLabel: "יתרת זכות",
    };
  }
  if (signed < -0.01) {
    return {
      openDebtAfter: exclusive.openDebtUsd,
      availableCreditAfter: exclusive.availableCreditUsd,
      signedBalanceUsd: signed,
      surplusPendingUsd,
      state: "debt",
      title: "יתרה",
      statusLabel: "חוב לתשלום",
    };
  }
  return {
    openDebtAfter: 0,
    availableCreditAfter: 0,
    signedBalanceUsd: 0,
    surplusPendingUsd,
    state: "cleared",
    title: "יתרה",
    statusLabel: surplusPendingUsd > 0.01 ? "חוב נסגר" : "מאוזן",
  };
}

export function paymentIntakeFinalBalanceFromPreview(
  preview: Pick<PaymentIntakePreview, "debtBefore" | "existingCredit" | "draftPaymentTotal">,
  surplusDestination?: PaymentIntakeSurplusDestination | null,
): PaymentIntakeFinalBalance {
  return paymentIntakeFinalCustomerBalance({
    debtBefore: preview.debtBefore,
    existingCredit: preview.existingCredit,
    draftPaymentUsd: preview.draftPaymentTotal,
    surplusDestination,
  });
}

/** כרטיס «יתרה» — כותרת קבועה, סכום חתום כמו מסך יתרות. */
export function paymentIntakeFinalBalanceCardDisplay(
  balance: PaymentIntakeFinalBalance,
  exchangeRate: number,
): PaymentBalanceDisplay {
  const abs = money2(Math.abs(balance.signedBalanceUsd));
  return {
    state: balance.state === "credit" ? "credit" : balance.state === "debt" ? "debt" : "cleared",
    title: "יתרה",
    statusHint: balance.statusLabel,
    balanceUsdSigned: balance.signedBalanceUsd,
    displayUsd: abs,
    displayIls: convertDebtUsdToIlsIncludingVat(abs, exchangeRate),
    surplusPendingUsd: balance.surplusPendingUsd,
  };
}

export function formatIntakeFinalBalanceUsdLine(signedUsd: number): string {
  return formatCustomerNetBalanceUsd(signedUsd);
}

export function formatIntakeSurplusPendingLine(surplusPendingUsd: number): string {
  const amount = money2(Math.max(0, surplusPendingUsd));
  if (amount <= 0.01) return "";
  return `עודף לטיפול: ${formatCustomerNetBalanceUsd(amount)}`;
}
