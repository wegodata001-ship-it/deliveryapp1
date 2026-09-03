import type { PaymentBusinessType, PaymentRecordStatus, Prisma } from "@prisma/client";
import {
  formatLedgerAmountDisplay,
  formatLedgerPaymentComponentDisplay,
  formatLedgerPaymentTotalUsd,
} from "@/lib/ledger-payment-display";
import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import {
  calculateLineTotalPaymentUsd,
  createDefaultPaymentLine,
  linePaymentMethod,
  normalizePaymentLine,
  roundMoney2,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import {
  COMMISSION_ADD_TO_BALANCE_LABEL,
  COMMISSION_REMOVE_FROM_BALANCE_LABEL,
  formatCommissionSignedCompact,
} from "@/lib/commission-lineage-view";

export type LedgerPaymentMethodBucket = {
  method: string;
  label: string;
  /** סכום מקורי בשקלים — null כשלא נרשם ₪ */
  amountIls: string | null;
  /** שווי בדולר (כולל המרה מ-₪) */
  amountUsd: string;
};

export type LedgerPaymentOrderAllocation = {
  orderNumber: string;
  amountUsd: string;
};

export type LedgerPaymentCheckLine = {
  checkNumber: string;
  amountUsd: string;
};

export type LedgerPaymentCurrencyComponent = {
  currency: "USD" | "ILS";
  /** תווית בעברית — דולר / שקל */
  label: string;
  /** סכום מקורי במטבע — כפי שנקלט */
  amount: string;
};

export type LedgerPaymentExpandLine = {
  label: string;
  display: string;
  tone?: "commission";
  orderId?: string | null;
  orderNumber?: string | null;
};

export type LedgerPaymentCommissionFee = {
  amountUsd: string;
  orderId: string | null;
  orderNumber: string | null;
};

export type LedgerPaymentDetail = {
  paymentCode: string;
  totalUsd: string;
  /** סה״כ שקלים שנרשמו בקליטה */
  totalIls: string | null;
  /** רכיבי מטבע מקוריים — לא שווי דולרי מומר */
  components: LedgerPaymentCurrencyComponent[];
  methods: LedgerPaymentMethodBucket[];
  checks: LedgerPaymentCheckLine[];
  orders: LedgerPaymentOrderAllocation[];
  /** סכום שנסגר לחוב (הקצאות להזמנות) */
  debtClosedUsd?: string | null;
  /** עודף שנשמר כיתרת זכות — נפרד מעמלה */
  creditSurplusUsd?: string | null;
  /** תוספת/הפחתה לעמלות שנוצרה מתשלום זה */
  commissionToFeeUsd?: string | null;
  commissionFees?: LedgerPaymentCommissionFee[];
};

export type LedgerPaymentMethodDisplayLine = {
  /** מזהה אמצעי תשלום קנוני — לצביעה אחידה */
  method: string;
  label: string;
  amountIls: string | null;
  amountUsd: string;
};

const METHOD_SORT_ORDER: readonly string[] = [
  "CASH",
  "CHECK",
  "BANK_TRANSFER",
  "BANK_TRANSFER_DONE",
  "CREDIT",
  "OTHER",
];

type MethodAmountAcc = { ils: number; usd: number };

function emptyAcc(): MethodAmountAcc {
  return { ils: 0, usd: 0 };
}

function methodKey(raw: string): string {
  const id = normalizePaymentMethodId(raw.trim());
  return id || "OTHER";
}

function addBucket(
  map: Map<string, MethodAmountAcc>,
  methodRaw: string,
  patch: Partial<MethodAmountAcc>,
): void {
  const key = methodKey(methodRaw);
  const prev = map.get(key) ?? emptyAcc();
  map.set(key, {
    ils: roundMoney2(prev.ils + (patch.ils ?? 0)),
    usd: roundMoney2(prev.usd + (patch.usd ?? 0)),
  });
}

function mergeBucketMaps(...maps: Map<string, MethodAmountAcc>[]): Map<string, MethodAmountAcc> {
  const out = new Map<string, MethodAmountAcc>();
  for (const m of maps) {
    for (const [k, v] of m) {
      const prev = out.get(k) ?? emptyAcc();
      out.set(k, {
        ils: roundMoney2(prev.ils + v.ils),
        usd: roundMoney2(prev.usd + v.usd),
      });
    }
  }
  return out;
}

export function ledgerPaymentMethodLabel(m: string): string {
  const id = methodKey(m);
  return PAYMENT_METHOD_LABELS[id] ?? id;
}

function mapPrismaMethod(m: string | null | undefined): string {
  return methodKey(m ?? "");
}

function parseAmountToken(raw: string): number | "" {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : "";
}

function mapMethodToken(token: string): string {
  return methodKey(token);
}

/** פירוק שורות # מתוך notes — זהה לקליטת תשלום */
export function parsePaymentLinesFromNotes(notes: string | null | undefined): PaymentLine[] {
  const txt = (notes ?? "").trim();
  if (!txt) return [];
  const lines = txt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("#"));

  const parsed: PaymentLine[] = [];
  for (const line of lines) {
    const dualUsd = line.match(/USD\s+\$([\d.,]+)/i);
    const dualIls = line.match(/ILS\s+₪([\d.,]+)/i);
    if (dualUsd || dualIls) {
      const usdMethod = line.match(/USD\s+\$[\d.,]+\s·\s([A-Z0-9_]+)/i)?.[1];
      const ilsMethod = line.match(/ILS\s+₪[\d.,]+\s·\s([A-Z0-9_]+)/i)?.[1];
      const vatMatch = line.match(/vatMode=([A-Z_]+)/)?.[1];
      parsed.push({
        ...createDefaultPaymentLine(`hist_${parsed.length + 1}`),
        usdAmount: dualUsd ? parseAmountToken(dualUsd[1] ?? "0") : "",
        ilsAmount: dualIls ? parseAmountToken(dualIls[1] ?? "0") : "",
        usdPaymentMethod: mapMethodToken(usdMethod ?? "CASH") as PaymentLineMethod,
        ilsPaymentMethod: mapMethodToken(ilsMethod ?? "CASH") as PaymentLineMethod,
        vatMode:
          vatMatch === "EXEMPT" || vatMatch === "BEFORE_VAT" || vatMatch === "INCLUDING_VAT"
            ? vatMatch
            : "INCLUDING_VAT",
      });
      continue;
    }

    const m = line.match(/^#\d+\s+([$₪])\s?([\d.,]+)\s·\s([A-Z_]+)\s·\s([A-Z_0-9]+)(?:\s\|\s.*)?$/);
    if (!m) continue;
    const noteMatch = line.match(/\|\s*note=(.*)$/);
    const cur = (m[1] ?? "$") === "$" ? "USD" : "ILS";
    const amt = parseAmountToken(m[2] ?? "0");
    const base = createDefaultPaymentLine(`hist_${parsed.length + 1}`);
    parsed.push({
      ...base,
      vatMode:
        m[3] === "EXEMPT" || m[3] === "BEFORE_VAT" || m[3] === "INCLUDING_VAT" ? m[3] : "INCLUDING_VAT",
      ...(cur === "USD"
        ? {
            usdAmount: amt,
            usdPaymentMethod: mapMethodToken(m[4] ?? "CASH") as PaymentLineMethod,
            usdNote: noteMatch?.[1]?.trim() ?? "",
          }
        : {
            ilsAmount: amt,
            ilsPaymentMethod: mapMethodToken(m[4] ?? "CASH") as PaymentLineMethod,
            ilsNote: noteMatch?.[1]?.trim() ?? "",
          }),
    });
  }
  return parsed;
}

function parseLegacyIntakeBuckets(
  notes: string,
  defaultMethod: string,
  exchangeRate: number,
): Map<string, MethodAmountAcc> {
  const buckets = new Map<string, MethodAmountAcc>();
  const intakeLine = notes
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("קליטה:"));
  if (!intakeLine) return buckets;

  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 0;
  const usdM = intakeLine.match(/USD\s+([\d.,]+)/i);
  const ilsM = intakeLine.match(/₪\s*([\d.,]+)/);
  const transferM = intakeLine.match(/העברה\s*₪\s*([\d.,]+)/);
  const noVatM = intakeLine.match(/ללא\s*מע״מ\s*₪\s*([\d.,]+)/);

  const addIls = (method: string, ils: number) => {
    if (!Number.isFinite(ils) || ils <= 0) return;
    const usd = rate > 0 ? roundMoney2(ils / rate) : 0;
    addBucket(buckets, method, { ils, usd });
  };
  const addUsd = (method: string, usd: number) => {
    if (!Number.isFinite(usd) || usd <= 0) return;
    addBucket(buckets, method, { usd: roundMoney2(usd) });
  };

  if (usdM) addUsd(defaultMethod, Number(usdM[1].replace(/,/g, "")));
  if (ilsM) addIls(defaultMethod, Number(ilsM[1].replace(/,/g, "")));
  if (transferM) addIls("BANK_TRANSFER", Number(transferM[1].replace(/,/g, "")));
  if (noVatM) addIls("OTHER", Number(noVatM[1].replace(/,/g, "")));

  return buckets;
}

function bucketsFromPaymentLines(lines: PaymentLine[], exchangeRate: number): Map<string, MethodAmountAcc> {
  const buckets = new Map<string, MethodAmountAcc>();
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 0;

  for (const line of lines) {
    const n = normalizePaymentLine(line);
    const usdRaw = typeof n.usdAmount === "number" && n.usdAmount > 0 ? n.usdAmount : 0;
    if (usdRaw > 0) addBucket(buckets, n.usdPaymentMethod, { usd: usdRaw });

    const ilsRaw = typeof n.ilsAmount === "number" && n.ilsAmount > 0 ? n.ilsAmount : 0;
    if (ilsRaw > 0) {
      const usdFromIls = rate > 0 ? roundMoney2(ilsRaw / rate) : 0;
      addBucket(buckets, n.ilsPaymentMethod, { ils: ilsRaw, usd: usdFromIls });
      continue;
    }

    const calc = calculateLineTotalPaymentUsd(n, rate);
    const ilsUsd = roundMoney2(calc - usdRaw);
    if (ilsUsd > 0) addBucket(buckets, n.ilsPaymentMethod, { usd: ilsUsd });
    if (usdRaw <= 0 && ilsUsd <= 0 && calc > 0) addBucket(buckets, linePaymentMethod(n), { usd: calc });
  }
  return buckets;
}

function isInternalLedgerPaymentRow(row: LedgerPaymentBatchRow): boolean {
  return (
    row.businessType === "CUSTOMER_CREDIT" ||
    row.businessType === "ADJUSTMENT_FEE" ||
    row.businessType === "CREDIT_APPLICATION" ||
    row.businessType === "BALANCE_RESET"
  );
}

function paymentRowUsdEquivalent(row: LedgerPaymentBatchRow): number {
  const usd = Number(row.amountUsd ?? 0);
  if (Number.isFinite(usd) && usd > 0.005) return roundMoney2(usd);
  const ils = Number(row.amountIls ?? 0);
  const rate = Number(row.exchangeRate ?? 0);
  if (Number.isFinite(ils) && ils > 0 && rate > 0) return roundMoney2(ils / rate);
  return 0;
}

/** פירוק שורות # מ-notes — סכומים מקוריים לפי אמצעי */
function bucketsFromIntakeNotesBreakdown(
  notes: string | null | undefined,
  exchangeRate: number,
): Map<string, MethodAmountAcc> {
  const buckets = new Map<string, MethodAmountAcc>();
  const txt = (notes ?? "").trim();
  if (!txt) return buckets;
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 0;

  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) continue;

    for (const m of trimmed.matchAll(/USD\s+\$([\d.,]+)\s·\s([A-Z0-9_]+)/gi)) {
      const amt = Number(String(m[1] ?? "").replace(/,/g, ""));
      if (Number.isFinite(amt) && amt > 0) addBucket(buckets, mapMethodToken(String(m[2] ?? "CASH")), { usd: amt });
    }
    for (const m of trimmed.matchAll(/ILS\s+₪([\d.,]+)\s·\s([A-Z0-9_]+)/gi)) {
      const ils = Number(String(m[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(ils) || ils <= 0) continue;
      const usd = rate > 0 ? roundMoney2(ils / rate) : 0;
      addBucket(buckets, mapMethodToken(String(m[2] ?? "CASH")), { ils, usd });
    }
  }
  return buckets;
}

function bucketsFromBatchRows(batchRows: LedgerPaymentBatchRow[]): Map<string, MethodAmountAcc> {
  const buckets = new Map<string, MethodAmountAcc>();
  for (const row of batchRows) {
    if (row.status === "CANCELLED" || isInternalLedgerPaymentRow(row)) continue;
    const rate = Number(row.exchangeRate ?? 0);
    const usdAmt = Number(row.amountUsd ?? 0);
    if (Number.isFinite(usdAmt) && usdAmt > 0) {
      addBucket(buckets, mapPrismaMethod(row.usdPaymentMethod ?? row.paymentMethod), { usd: usdAmt });
    }
    const ilsAmt = Number(row.amountIls ?? 0);
    if (Number.isFinite(ilsAmt) && ilsAmt > 0) {
      const usdFromIls = rate > 0 ? roundMoney2(ilsAmt / rate) : 0;
      addBucket(buckets, mapPrismaMethod(row.ilsPaymentMethod ?? row.paymentMethod), {
        ils: ilsAmt,
        usd: usdFromIls,
      });
    }
  }
  return buckets;
}

function mergeOrderAllocations(
  batchRows: LedgerPaymentBatchRow[],
  orderNumberById: Map<string, string>,
): LedgerPaymentOrderAllocation[] {
  const byKey = new Map<string, number>();
  for (const row of batchRows) {
    if (row.status === "CANCELLED") continue;
    const oid = row.orderId?.trim();
    if (!oid) continue;
    const amt = paymentRowUsdEquivalent(row);
    if (amt <= 0.005) continue;
    const orderNumber = orderNumberById.get(oid) ?? oid;
    byKey.set(orderNumber, roundMoney2((byKey.get(orderNumber) ?? 0) + amt));
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "he"))
    .map(([orderNumber, amountUsd]) => ({ orderNumber, amountUsd: amountUsd.toFixed(2) }));
}

function sortMethodKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = METHOD_SORT_ORDER.indexOf(a);
    const ib = METHOD_SORT_ORDER.indexOf(b);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, "he");
  });
}

function sortedMethodBuckets(raw: Map<string, MethodAmountAcc>): LedgerPaymentMethodBucket[] {
  const out: LedgerPaymentMethodBucket[] = [];
  const keys = [...raw.keys()].sort((a, b) => {
    const baseA = a.split("::")[0] ?? a;
    const baseB = b.split("::")[0] ?? b;
    const ia = METHOD_SORT_ORDER.indexOf(baseA);
    const ib = METHOD_SORT_ORDER.indexOf(baseB);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, "he");
  });
  for (const key of keys) {
    const acc = raw.get(key);
    if (!acc || (acc.ils <= 0.005 && acc.usd <= 0.005)) continue;
    const method = key.split("::")[0] ?? key;
    out.push({
      method,
      label: ledgerPaymentMethodLabel(method),
      amountIls: acc.ils > 0.005 ? acc.ils.toFixed(2) : null,
      amountUsd: acc.usd.toFixed(2),
    });
  }
  return out;
}

export type LedgerPaymentMethodAllocationRow = {
  method: string;
  currency: string;
  sourceAmount: Prisma.Decimal | number;
  amountUsd: Prisma.Decimal | number;
};

export type LedgerPaymentBatchRow = {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  paymentDate: Date | null;
  createdAt?: Date | null;
  orderId: string | null;
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  notes: string | null;
  status: PaymentRecordStatus;
  businessType?: PaymentBusinessType;
  /** כסף שהתקבל בפועל — SSOT לקליטה, לא סכום FIFO לחוב */
  methodAllocations?: LedgerPaymentMethodAllocationRow[];
};

function decNum(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

/**
 * מלוא התשלום שנקלט — מ-PaymentMethodAllocation של שורת הקליטה הראשית.
 * לא מסכום שורות FIFO (allocation לחוב) ולא מהמרה מחדש של ₪/שער.
 */
function receivedFromMethodAllocations(batchRows: LedgerPaymentBatchRow[]): {
  methods: Map<string, MethodAmountAcc>;
  totalUsd: number;
  totalIls: number;
  usdNative: number;
  ilsNative: number;
} | null {
  const primary =
    batchRows.find((r) => r.paymentCode?.trim() && (r.methodAllocations?.length ?? 0) > 0) ??
    batchRows.find((r) => (r.methodAllocations?.length ?? 0) > 0);
  const allocs = primary?.methodAllocations;
  if (!allocs?.length) return null;

  const methods = new Map<string, MethodAmountAcc>();
  let totalUsd = 0;
  let ilsNative = 0;
  let usdNative = 0;
  for (const a of allocs) {
    const src = roundMoney2(Math.max(0, decNum(a.sourceAmount)));
    const usd = roundMoney2(Math.max(0, decNum(a.amountUsd)));
    const currency = String(a.currency ?? "").toUpperCase() === "ILS" ? "ILS" : "USD";
    const displayKey = `${methodKey(a.method)}::${currency}`;
    const prev = methods.get(displayKey) ?? emptyAcc();
    if (currency === "ILS") {
      methods.set(displayKey, {
        ils: roundMoney2(prev.ils + src),
        usd: roundMoney2(prev.usd + usd),
      });
      ilsNative = roundMoney2(ilsNative + src);
    } else {
      const native = src > 0.005 ? src : usd;
      methods.set(displayKey, {
        ils: prev.ils,
        usd: roundMoney2(prev.usd + native),
      });
      usdNative = roundMoney2(usdNative + native);
    }
    totalUsd = roundMoney2(totalUsd + usd);
  }
  if (totalUsd <= 0.005 && ilsNative <= 0.005 && usdNative <= 0.005) return null;
  return { methods, totalUsd, totalIls: ilsNative, usdNative, ilsNative };
}

export function paymentBatchGroupKey(p: LedgerPaymentBatchRow): string {
  if (p.paymentNumber != null) return `n:${p.paymentNumber}`;
  const code = p.paymentCode?.trim();
  if (code) return `c:${code}`;
  return `id:${p.id}`;
}

function sumBatchIls(batchRows: LedgerPaymentBatchRow[]): number {
  let sum = 0;
  for (const row of batchRows) {
    if (row.status === "CANCELLED") continue;
    const ils = Number(row.amountIls ?? 0);
    if (Number.isFinite(ils) && ils > 0) sum += ils;
  }
  return roundMoney2(sum);
}

function notesHaveMethodBreakdown(notes: string): boolean {
  if (!notes.trim()) return false;
  return notes.split("\n").some((l) => {
    const t = l.trim();
    return t.startsWith("#") && (/\bILS\s+₪/.test(t) || /\bUSD\s+\$/.test(t));
  });
}

function buildPaymentCurrencyComponents(
  parsedLines: PaymentLine[],
  bucketMap: Map<string, MethodAmountAcc>,
): LedgerPaymentCurrencyComponent[] {
  let usdNative = 0;
  let ilsNative = 0;

  if (parsedLines.length > 0) {
    for (const line of parsedLines) {
      const n = normalizePaymentLine(line);
      if (typeof n.usdAmount === "number" && n.usdAmount > 0) usdNative += n.usdAmount;
      if (typeof n.ilsAmount === "number" && n.ilsAmount > 0) ilsNative += n.ilsAmount;
    }
  } else {
    for (const acc of bucketMap.values()) {
      if (acc.ils > 0.005) ilsNative += acc.ils;
      if (acc.ils <= 0.005 && acc.usd > 0.005) usdNative += acc.usd;
    }
  }

  usdNative = roundMoney2(usdNative);
  ilsNative = roundMoney2(ilsNative);

  const out: LedgerPaymentCurrencyComponent[] = [];
  if (usdNative > 0.005) {
    out.push({ currency: "USD", label: "דולר", amount: usdNative.toFixed(2) });
  }
  if (ilsNative > 0.005) {
    out.push({ currency: "ILS", label: "שקל", amount: ilsNative.toFixed(2) });
  }
  return out;
}

export function buildLedgerPaymentDetail(params: {
  batchRows: LedgerPaymentBatchRow[];
  orderNumberById: Map<string, string>;
  checkAmountUsdByPaymentId?: Map<string, number>;
  checksByPaymentId?: Map<string, LedgerPaymentCheckLine[]>;
  commissionFees?: Array<{
    amountUsd: number;
    orderId: string | null;
    orderNumber?: string | null;
  }>;
}): LedgerPaymentDetail | null {
  const { batchRows, orderNumberById, checkAmountUsdByPaymentId, checksByPaymentId } = params;
  if (batchRows.length === 0) return null;

  const primary = batchRows.find((r) => r.paymentCode?.trim()) ?? batchRows[0];
  const paymentCode = primary.paymentCode?.trim() || "תשלום";
  const notes = (primary.notes ?? batchRows.find((r) => r.notes?.trim())?.notes ?? "").trim();
  const rate = Number(primary.exchangeRate ?? 0);
  const defaultMethod = mapPrismaMethod(
    primary.usdPaymentMethod ?? primary.ilsPaymentMethod ?? primary.paymentMethod,
  );

  const received = receivedFromMethodAllocations(batchRows);

  const fromIntakeRegex = bucketsFromIntakeNotesBreakdown(notes, rate);
  const parsedLines = parsePaymentLinesFromNotes(notes);
  const fromParsed = bucketsFromPaymentLines(parsedLines, rate);

  let fromNotes: Map<string, MethodAmountAcc>;
  if (fromIntakeRegex.size >= fromParsed.size && fromIntakeRegex.size > 0) {
    fromNotes = fromIntakeRegex;
  } else if (fromParsed.size > 0) {
    fromNotes = fromParsed;
  } else {
    fromNotes = mergeBucketMaps(
      fromIntakeRegex,
      notes ? parseLegacyIntakeBuckets(notes, defaultMethod, rate) : new Map(),
    );
  }

  const bucketMap =
    received?.methods ??
    mergeBucketMaps(
      fromNotes,
      notesHaveMethodBreakdown(notes) ? new Map() : bucketsFromBatchRows(batchRows),
    );

  const checkUsd = checkAmountUsdByPaymentId?.get(primary.id) ?? 0;
  if (checkUsd > 0.005) {
    addBucket(bucketMap, "CHECK", { usd: checkUsd });
  }

  let allocatedUsd = 0;
  let creditSurplusUsd = 0;
  for (const row of batchRows) {
    if (row.status === "CANCELLED") continue;
    const rowUsd = paymentRowUsdEquivalent(row);
    allocatedUsd += rowUsd;
    if (row.businessType === "CUSTOMER_CREDIT") {
      creditSurplusUsd += rowUsd;
    }
  }
  allocatedUsd = roundMoney2(allocatedUsd);
  creditSurplusUsd = roundMoney2(creditSurplusUsd);
  // מלוא הקליטה — allocations; FIFO rows הם רק הקצאה לחוב/זכות.
  const totalUsd = received ? received.totalUsd : allocatedUsd;

  if (bucketMap.size === 0 && totalUsd > 0.005) {
    addBucket(bucketMap, defaultMethod, { usd: roundMoney2(totalUsd - creditSurplusUsd) });
  }

  const totalIlsN = received
    ? received.totalIls
    : sumBatchIls(batchRows.filter((r) => !isInternalLedgerPaymentRow(r)));
  const orders = mergeOrderAllocations(batchRows, orderNumberById);
  const debtClosedUsd = roundMoney2(
    orders.reduce((sum, o) => sum + Number(o.amountUsd), 0),
  );
  const checks = checksByPaymentId?.get(primary.id) ?? [];
  const components = received
    ? ([
        ...(received.usdNative > 0.005
          ? [{ currency: "USD" as const, label: "דולר", amount: received.usdNative.toFixed(2) }]
          : []),
        ...(received.ilsNative > 0.005
          ? [{ currency: "ILS" as const, label: "שקל", amount: received.ilsNative.toFixed(2) }]
          : []),
      ] satisfies LedgerPaymentCurrencyComponent[])
    : buildPaymentCurrencyComponents(parsedLines, bucketMap);

  const commissionFees: LedgerPaymentCommissionFee[] = [];
  let commissionToFeeUsd = 0;
  for (const fee of params.commissionFees ?? []) {
    const amt = roundMoney2(Number(fee.amountUsd) || 0);
    if (Math.abs(amt) <= 0.005) continue;
    commissionToFeeUsd += amt;
    commissionFees.push({
      amountUsd: amt.toFixed(2),
      orderId: fee.orderId,
      orderNumber: fee.orderNumber ?? (fee.orderId ? orderNumberById.get(fee.orderId) ?? null : null),
    });
  }
  if (commissionFees.length === 0) {
    for (const row of batchRows) {
      if (row.status === "CANCELLED" || row.businessType !== "ADJUSTMENT_FEE") continue;
      const amt = paymentRowUsdEquivalent(row);
      if (Math.abs(amt) <= 0.005) continue;
      commissionToFeeUsd += amt;
      commissionFees.push({
        amountUsd: amt.toFixed(2),
        orderId: row.orderId,
        orderNumber: row.orderId ? orderNumberById.get(row.orderId) ?? null : null,
      });
    }
  }
  commissionToFeeUsd = roundMoney2(commissionToFeeUsd);

  return {
    paymentCode,
    totalUsd: totalUsd.toFixed(2),
    totalIls: totalIlsN > 0.005 ? totalIlsN.toFixed(2) : null,
    components,
    methods: sortedMethodBuckets(bucketMap),
    checks,
    orders,
    debtClosedUsd: debtClosedUsd > 0.005 ? debtClosedUsd.toFixed(2) : null,
    creditSurplusUsd: creditSurplusUsd > 0.005 ? creditSurplusUsd.toFixed(2) : null,
    commissionToFeeUsd: Math.abs(commissionToFeeUsd) > 0.005 ? commissionToFeeUsd.toFixed(2) : null,
    commissionFees: commissionFees.length > 0 ? commissionFees : undefined,
  };
}

/** שורות תצוגה — כל אמצעי תשלום שנרשם */
export function ledgerPaymentMethodDisplayLines(
  detail: LedgerPaymentDetail | undefined | null,
): LedgerPaymentMethodDisplayLine[] {
  if (!detail) return [];
  const out: LedgerPaymentMethodDisplayLine[] = [];
  const hasChecks = detail.checks.length > 0;

  for (const m of detail.methods) {
    if (m.method === "CHECK" && hasChecks) {
      for (const c of detail.checks) {
        out.push({
          method: "CHECK",
          label: `צ'ק ${c.checkNumber}`,
          amountIls: null,
          amountUsd: c.amountUsd,
        });
      }
      continue;
    }
    out.push({
      method: m.method,
      label: m.label,
      amountIls: m.amountIls,
      amountUsd: m.amountUsd,
    });
  }

  if (hasChecks && !detail.methods.some((m) => m.method === "CHECK")) {
    for (const c of detail.checks) {
      out.push({
        method: "CHECK",
        label: `צ'ק ${c.checkNumber}`,
        amountIls: null,
        amountUsd: c.amountUsd,
      });
    }
  }

  return out;
}

function methodLineNativeDisplay(line: LedgerPaymentMethodDisplayLine): string {
  if (line.amountIls != null && Number(line.amountIls) > 0.005) {
    return formatLedgerPaymentComponentDisplay("ILS", line.amountIls);
  }
  return formatLedgerPaymentComponentDisplay("USD", line.amountUsd);
}

/** שורות פירוט לפתיחה — רכיבי מטבע או אמצעי תשלום (לא סה״כ דולרי) */
function ledgerPaymentAllocationExpandLines(detail: LedgerPaymentDetail): LedgerPaymentExpandLine[] {
  const out: LedgerPaymentExpandLine[] = [];
  const debtClosed = Number(detail.debtClosedUsd ?? 0);
  if (debtClosed > 0.005) {
    out.push({
      label: "סגירת חוב",
      display: formatLedgerPaymentComponentDisplay("USD", debtClosed.toFixed(2)),
    });
  }
  const creditSurplus = Number(detail.creditSurplusUsd ?? 0);
  if (creditSurplus > 0.005) {
    out.push({
      label: "יתרת זכות מתשלום יתר",
      display: `+${formatLedgerPaymentComponentDisplay("USD", creditSurplus.toFixed(2)).replace(/^\$?\s?/, "$")}`,
    });
  }
  for (const fee of detail.commissionFees ?? []) {
    const amt = Number(fee.amountUsd);
    if (!Number.isFinite(amt) || Math.abs(amt) <= 0.005) continue;
    out.push({
      label: amt >= 0 ? COMMISSION_ADD_TO_BALANCE_LABEL : COMMISSION_REMOVE_FROM_BALANCE_LABEL,
      display: formatCommissionSignedCompact(amt),
      tone: "commission",
      orderId: fee.orderId,
      orderNumber: fee.orderNumber,
    });
  }
  return out;
}

export function ledgerPaymentExpandLines(
  detail: LedgerPaymentDetail | undefined | null,
): LedgerPaymentExpandLine[] {
  if (!detail) return [];

  const allocationLines = ledgerPaymentAllocationExpandLines(detail);

  const methodLines = ledgerPaymentMethodDisplayLines(detail);
  if (methodLines.length > 1) {
    return [
      ...methodLines.map((m) => ({
        label: m.label,
        display: methodLineNativeDisplay(m),
      })),
      ...allocationLines,
    ];
  }

  const components = detail.components ?? [];
  if (components.length >= 2) {
    return [
      ...components.map((c) => ({
        label: c.label,
        display: formatLedgerPaymentComponentDisplay(c.currency, c.amount),
      })),
      ...allocationLines,
    ];
  }

  if (methodLines.length === 1) {
    const only = methodLines[0];
    if (only.amountIls != null && Number(only.amountIls) > 0.005) {
      return [
        { label: "שקל", display: formatLedgerPaymentComponentDisplay("ILS", only.amountIls) },
        ...allocationLines,
      ];
    }
  }

  if (allocationLines.length > 0) return allocationLines;

  return [];
}

export function shouldShowLedgerPaymentMethodSubrows(
  detail: LedgerPaymentDetail | undefined | null,
): boolean {
  return ledgerPaymentExpandLines(detail).length > 0;
}

export function formatLedgerPaymentDetailLines(detail: LedgerPaymentDetail | undefined | null): string[] {
  if (!detail) return [];
  const totalDisp = formatLedgerPaymentTotalUsd(detail.totalUsd);
  const lines: string[] = [`${detail.paymentCode} · סה״כ ${totalDisp}`];
  for (const row of ledgerPaymentExpandLines(detail)) {
    lines.push(`↳ ${row.label}: ${row.display}`);
  }
  for (const o of detail.orders) {
    lines.push(`${o.orderNumber} → $${o.amountUsd}`);
  }
  return lines;
}

export function formatLedgerPaymentDetailMultiline(detail: LedgerPaymentDetail | undefined | null): string {
  return formatLedgerPaymentDetailLines(detail).join("\n");
}
