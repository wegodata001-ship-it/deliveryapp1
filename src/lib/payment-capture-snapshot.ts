import type {
  PaymentIntakeCustomerPayload,
  PaymentIntakeCustomerPaymentRow,
} from "@/app/admin/payments/intake/actions";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { OrderCountryCode } from "@/lib/order-countries";
import type { PaymentLine } from "@/lib/payment-updated";

export type PaymentCaptureCustomerDraft = {
  code: string;
  displayName: string;
  nameEn: string;
  nameAr: string;
  phone: string;
  index: string;
};

export type PaymentCaptureEntryData = {
  id: string;
  paymentCode: string | null;
  paymentNumber?: number | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  dollarRate: string | null;
  commissionPercent?: string | null;
  status?: "ACTIVE" | "CANCELLED";
  cancelReason?: string | null;
  customer: {
    id: string;
    displayName: string;
    customerCode: string;
    customerIndex: string;
    nameEn: string;
    nameAr: string;
    phone: string;
  };
  lines: PaymentLine[];
};

/** Snapshot מלא לניווט מיידי — טופס + טבלת הזמנות + יתרות */
export type PaymentCaptureSnapshot = {
  paymentId: string;
  paymentCode: string;
  entry: PaymentCaptureEntryData;
  paymentDateYmd: string;
  paymentTimeHm: string;
  weekDraft: string;
  dollarRate: string;
  commissionPercentStr: string;
  payments: PaymentLine[];
  activePaymentLineIndex: number;
  previewPaymentCode: string | null;
  countryOverride: "AUTO" | OrderCountryCode;
  customer: PaymentIntakeCustomerPayload;
  customerPayments: PaymentIntakeCustomerPaymentRow[];
  orders: PaymentIntakeOrderRow[];
  draftCustomer: PaymentCaptureCustomerDraft;
  includedIds: string[] | null;
  commissionResetIds: string[];
  customerBalanceResetPending: boolean;
  balanceResetFromCredit: boolean;
  customerOpenDebtSignedUsd: number;
};

function cloneLines(lines: PaymentLine[]): PaymentLine[] {
  return lines.map((l) => ({
    ...l,
    checks: l.checks?.map((c) => ({ ...c })),
  }));
}

export function clonePaymentCaptureEntry(entry: PaymentCaptureEntryData): PaymentCaptureEntryData {
  return {
    ...entry,
    customer: { ...entry.customer },
    lines: cloneLines(entry.lines),
  };
}

export function clonePaymentCaptureSnapshot(s: PaymentCaptureSnapshot): PaymentCaptureSnapshot {
  return {
    ...s,
    entry: clonePaymentCaptureEntry(s.entry),
    payments: cloneLines(s.payments),
    customer: { ...s.customer },
    customerPayments: s.customerPayments.map((p) => ({ ...p })),
    orders: s.orders.map((o) => ({ ...o })),
    draftCustomer: { ...s.draftCustomer },
    includedIds: s.includedIds ? [...s.includedIds] : null,
    commissionResetIds: [...s.commissionResetIds],
  };
}

export type PaymentCaptureSnapshotCache = {
  get(paymentId: string): PaymentCaptureSnapshot | undefined;
  getByCode(paymentCode: string): PaymentCaptureSnapshot | undefined;
  set(snapshot: PaymentCaptureSnapshot): void;
  has(paymentId: string): boolean;
  clear(): void;
  keys(): string[];
};

export function createPaymentCaptureSnapshotCache(): PaymentCaptureSnapshotCache {
  const byId = new Map<string, PaymentCaptureSnapshot>();
  const byCode = new Map<string, PaymentCaptureSnapshot>();

  const index = (snap: PaymentCaptureSnapshot) => {
    const id = snap.paymentId.trim();
    const code = snap.paymentCode.trim().toUpperCase();
    const cloned = clonePaymentCaptureSnapshot(snap);
    byId.set(id, cloned);
    if (code) byCode.set(code, cloned);
  };

  return {
    get(paymentId: string) {
      const hit = byId.get(paymentId.trim());
      return hit ? clonePaymentCaptureSnapshot(hit) : undefined;
    },
    getByCode(paymentCode: string) {
      const hit = byCode.get(paymentCode.trim().toUpperCase());
      return hit ? clonePaymentCaptureSnapshot(hit) : undefined;
    },
    set(snapshot: PaymentCaptureSnapshot) {
      index(snapshot);
    },
    has(paymentId: string) {
      return byId.has(paymentId.trim());
    },
    clear() {
      byId.clear();
      byCode.clear();
    },
    keys() {
      return [...byId.keys()];
    },
  };
}
