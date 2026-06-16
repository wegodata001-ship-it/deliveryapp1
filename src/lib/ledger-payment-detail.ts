import type { PaymentMethod, PaymentRecordStatus, Prisma } from "@prisma/client";
import {
  calculateLineTotalPaymentUsd,
  createDefaultPaymentLine,
  linePaymentMethod,
  normalizePaymentLine,
  roundMoney2,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";

export type LedgerPaymentMethodBucket = {
  method: PaymentLineMethod;
  label: string;
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

export type LedgerPaymentDetail = {
  paymentCode: string;
  totalUsd: string;
  methods: LedgerPaymentMethodBucket[];
  checks: LedgerPaymentCheckLine[];
  orders: LedgerPaymentOrderAllocation[];
};

export type LedgerPaymentMethodDisplayLine = {
  label: string;
  amountUsd: string;
};

const METHOD_ORDER: PaymentLineMethod[] = ["CASH", "CHECK", "BANK_TRANSFER", "CREDIT", "OTHER"];

export function ledgerPaymentMethodLabel(m: PaymentLineMethod): string {
  if (m === "CREDIT") return "אשראי";
  if (m === "BANK_TRANSFER") return "העברה בנקאית";
  if (m === "CASH") return "מזומן";
  if (m === "CHECK") return "צ׳ק";
  return "אחר";
}

function mapPrismaMethod(m: PaymentMethod | null | undefined): PaymentLineMethod {
  if (m === "CREDIT") return "CREDIT";
  if (m === "BANK_TRANSFER" || m === "BANK_TRANSFER_DONE") return "BANK_TRANSFER";
  if (m === "CASH") return "CASH";
  if (m === "CHECK") return "CHECK";
  return "OTHER";
}

function parseAmountToken(raw: string): number | "" {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : "";
}

function mapMethodToken(token: string): PaymentLineMethod {
  if (token === "CREDIT" || token === "BANK_TRANSFER" || token === "CASH" || token === "CHECK" || token === "OTHER")
    return token;
  return "CASH";
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
      const usdMethod = line.match(/USD\s+\$[\d.,]+\s·\s([A-Z_]+)/)?.[1];
      const ilsMethod = line.match(/ILS\s+₪[\d.,]+\s·\s([A-Z_]+)/)?.[1];
      const vatMatch = line.match(/vatMode=([A-Z_]+)/)?.[1];
      parsed.push({
        ...createDefaultPaymentLine(`hist_${parsed.length + 1}`),
        usdAmount: dualUsd ? parseAmountToken(dualUsd[1] ?? "0") : "",
        ilsAmount: dualIls ? parseAmountToken(dualIls[1] ?? "0") : "",
        usdPaymentMethod: mapMethodToken(usdMethod ?? "CASH"),
        ilsPaymentMethod: mapMethodToken(ilsMethod ?? "CASH"),
        vatMode:
          vatMatch === "EXEMPT" || vatMatch === "BEFORE_VAT" || vatMatch === "INCLUDING_VAT"
            ? vatMatch
            : "INCLUDING_VAT",
      });
      continue;
    }

    const m = line.match(/^#\d+\s+([$₪])\s?([\d.,]+)\s·\s([A-Z_]+)\s·\s([A-Z_]+)(?:\s\|\s.*)?$/);
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
        ? { usdAmount: amt, usdPaymentMethod: mapMethodToken(m[4] ?? "CASH"), usdNote: noteMatch?.[1]?.trim() ?? "" }
        : { ilsAmount: amt, ilsPaymentMethod: mapMethodToken(m[4] ?? "CASH"), ilsNote: noteMatch?.[1]?.trim() ?? "" }),
    });
  }
  return parsed;
}

function parseLegacyIntakeBuckets(
  notes: string,
  defaultMethod: PaymentLineMethod,
  exchangeRate: number,
): Map<PaymentLineMethod, number> {
  const buckets = new Map<PaymentLineMethod, number>();
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

  const add = (method: PaymentLineMethod, ilsOrUsd: number, isIls: boolean) => {
    if (!Number.isFinite(ilsOrUsd) || ilsOrUsd <= 0) return;
    const usd = isIls && rate > 0 ? roundMoney2(ilsOrUsd / rate) : roundMoney2(ilsOrUsd);
    buckets.set(method, roundMoney2((buckets.get(method) ?? 0) + usd));
  };

  if (usdM) add(defaultMethod, Number(usdM[1].replace(/,/g, "")), false);
  if (ilsM) add(defaultMethod, Number(ilsM[1].replace(/,/g, "")), true);
  if (transferM) add("BANK_TRANSFER", Number(transferM[1].replace(/,/g, "")), true);
  if (noVatM) add("OTHER", Number(noVatM[1].replace(/,/g, "")), true);

  return buckets;
}

function bucketsFromPaymentLines(lines: PaymentLine[], exchangeRate: number): Map<PaymentLineMethod, number> {
  const buckets = new Map<PaymentLineMethod, number>();
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 0;
  const add = (method: PaymentLineMethod, usd: number) => {
    if (usd <= 0.005) return;
    buckets.set(method, roundMoney2((buckets.get(method) ?? 0) + usd));
  };
  for (const line of lines) {
    const n = normalizePaymentLine(line);
    const usdRaw = typeof n.usdAmount === "number" && n.usdAmount > 0 ? n.usdAmount : 0;
    if (usdRaw > 0) add(n.usdPaymentMethod, usdRaw);
    const calc = calculateLineTotalPaymentUsd(n, rate);
    const ilsUsd = roundMoney2(calc - usdRaw);
    if (ilsUsd > 0) add(n.ilsPaymentMethod, ilsUsd);
    if (usdRaw <= 0 && ilsUsd <= 0 && calc > 0) add(linePaymentMethod(n), calc);
  }
  return buckets;
}

function paymentRowUsdEquivalent(row: LedgerPaymentBatchRow): number {
  const usd = Number(row.amountUsd ?? 0);
  if (Number.isFinite(usd) && usd > 0.005) return roundMoney2(usd);
  const ils = Number(row.amountIls ?? 0);
  const rate = Number(row.exchangeRate ?? 0);
  if (Number.isFinite(ils) && ils > 0 && rate > 0) return roundMoney2(ils / rate);
  return 0;
}

/** פירוק שורות # מ-notes של קליטת תשלום — סכומים כפי שנשמרו (USD/ILS · METHOD) */
function bucketsFromIntakeNotesBreakdown(
  notes: string | null | undefined,
  exchangeRate: number,
): Map<PaymentLineMethod, number> {
  const buckets = new Map<PaymentLineMethod, number>();
  const txt = (notes ?? "").trim();
  if (!txt) return buckets;
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 0;
  const add = (method: PaymentLineMethod, usd: number) => {
    if (usd <= 0.005) return;
    buckets.set(method, roundMoney2((buckets.get(method) ?? 0) + usd));
  };

  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) continue;

    for (const m of trimmed.matchAll(/USD\s+\$([\d.,]+)\s·\s([A-Z_]+)/gi)) {
      const amt = Number(String(m[1] ?? "").replace(/,/g, ""));
      if (Number.isFinite(amt) && amt > 0) add(mapMethodToken(String(m[2] ?? "CASH")), amt);
    }
    for (const m of trimmed.matchAll(/ILS\s+₪([\d.,]+)\s·\s([A-Z_]+)/gi)) {
      const ils = Number(String(m[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(ils) || ils <= 0) continue;
      const usd = rate > 0 ? roundMoney2(ils / rate) : 0;
      if (usd > 0) add(mapMethodToken(String(m[2] ?? "CASH")), usd);
    }
  }
  return buckets;
}

function bucketsFromBatchRows(batchRows: LedgerPaymentBatchRow[]): Map<PaymentLineMethod, number> {
  const buckets = new Map<PaymentLineMethod, number>();
  const add = (method: PaymentLineMethod, usd: number) => {
    if (usd <= 0.005) return;
    buckets.set(method, roundMoney2((buckets.get(method) ?? 0) + usd));
  };
  for (const row of batchRows) {
    if (row.status === "CANCELLED") continue;
    const rate = Number(row.exchangeRate ?? 0);
    const usdAmt = Number(row.amountUsd ?? 0);
    if (Number.isFinite(usdAmt) && usdAmt > 0) {
      add(mapPrismaMethod(row.usdPaymentMethod ?? row.paymentMethod), usdAmt);
    }
    const ilsAmt = Number(row.amountIls ?? 0);
    if (Number.isFinite(ilsAmt) && ilsAmt > 0 && rate > 0) {
      add(mapPrismaMethod(row.ilsPaymentMethod ?? row.paymentMethod), roundMoney2(ilsAmt / rate));
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

function sortedMethodBuckets(raw: Map<PaymentLineMethod, number>): LedgerPaymentMethodBucket[] {
  const out: LedgerPaymentMethodBucket[] = [];
  for (const method of METHOD_ORDER) {
    const amt = raw.get(method) ?? 0;
    if (amt <= 0.005) continue;
    out.push({
      method,
      label: ledgerPaymentMethodLabel(method),
      amountUsd: amt.toFixed(2),
    });
  }
  return out;
}

export type LedgerPaymentBatchRow = {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  paymentDate: Date | null;
  orderId: string | null;
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
  paymentMethod: PaymentMethod | null;
  usdPaymentMethod: PaymentMethod | null;
  ilsPaymentMethod: PaymentMethod | null;
  notes: string | null;
  status: PaymentRecordStatus;
};

export function paymentBatchGroupKey(p: LedgerPaymentBatchRow): string {
  if (p.paymentNumber != null) return `n:${p.paymentNumber}`;
  const code = p.paymentCode?.trim();
  if (code) return `c:${code}`;
  return `id:${p.id}`;
}

export function buildLedgerPaymentDetail(params: {
  batchRows: LedgerPaymentBatchRow[];
  orderNumberById: Map<string, string>;
  checkAmountUsdByPaymentId?: Map<string, number>;
  checksByPaymentId?: Map<string, LedgerPaymentCheckLine[]>;
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

  let bucketMap = bucketsFromIntakeNotesBreakdown(notes, rate);
  if (bucketMap.size === 0) {
    bucketMap = bucketsFromPaymentLines(parsePaymentLinesFromNotes(notes), rate);
  }
  if (bucketMap.size === 0 && notes) {
    bucketMap = parseLegacyIntakeBuckets(notes, defaultMethod, rate);
  }
  if (bucketMap.size === 0) {
    bucketMap = bucketsFromBatchRows(batchRows);
  }

  const checkUsd = checkAmountUsdByPaymentId?.get(primary.id) ?? 0;
  if (checkUsd > 0.005) {
    bucketMap.set("CHECK", roundMoney2((bucketMap.get("CHECK") ?? 0) + checkUsd));
  }

  let totalUsd = 0;
  for (const row of batchRows) {
    const n = Number(row.amountUsd ?? 0);
    if (Number.isFinite(n) && n > 0) totalUsd += n;
  }
  totalUsd = roundMoney2(totalUsd);

  if (bucketMap.size === 0 && totalUsd > 0.005) {
    bucketMap.set(defaultMethod, totalUsd);
  }

  const orders = mergeOrderAllocations(batchRows, orderNumberById);
  const checks = checksByPaymentId?.get(primary.id) ?? [];

  return {
    paymentCode,
    totalUsd: totalUsd.toFixed(2),
    methods: sortedMethodBuckets(bucketMap),
    checks,
    orders,
  };
}

/** שורות תצוגה בלבד — ↳ מזומן / צ'ק / העברה (ללא השפעה על יתרה) */
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
          label: `צ'ק ${c.checkNumber}`,
          amountUsd: c.amountUsd,
        });
      }
      continue;
    }
    out.push({ label: m.label, amountUsd: m.amountUsd });
  }

  if (hasChecks && !detail.methods.some((m) => m.method === "CHECK")) {
    for (const c of detail.checks) {
      out.push({
        label: `צ'ק ${c.checkNumber}`,
        amountUsd: c.amountUsd,
      });
    }
  }

  return out;
}

export function shouldShowLedgerPaymentMethodSubrows(
  detail: LedgerPaymentDetail | undefined | null,
): boolean {
  const lines = ledgerPaymentMethodDisplayLines(detail);
  if (lines.length <= 1) return false;
  return lines.length > 1;
}

export function formatLedgerPaymentDetailLines(detail: LedgerPaymentDetail | undefined | null): string[] {
  if (!detail) return [];
  const lines: string[] = [`${detail.paymentCode} · סה״כ ${detail.totalUsd}$`];
  for (const m of ledgerPaymentMethodDisplayLines(detail)) {
    lines.push(`↳ ${m.label}: $${m.amountUsd}`);
  }
  for (const o of detail.orders) {
    lines.push(`${o.orderNumber} → $${o.amountUsd}`);
  }
  return lines;
}

export function formatLedgerPaymentDetailMultiline(detail: LedgerPaymentDetail | undefined | null): string {
  return formatLedgerPaymentDetailLines(detail).join("\n");
}
