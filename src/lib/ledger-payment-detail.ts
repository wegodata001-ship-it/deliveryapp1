import type { PaymentRecordStatus, Prisma } from "@prisma/client";
import { formatLedgerAmountDisplay } from "@/lib/ledger-payment-display";
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

export type LedgerPaymentDetail = {
  paymentCode: string;
  totalUsd: string;
  /** סה״כ שקלים שנרשמו בקליטה */
  totalIls: string | null;
  methods: LedgerPaymentMethodBucket[];
  checks: LedgerPaymentCheckLine[];
  orders: LedgerPaymentOrderAllocation[];
};

export type LedgerPaymentMethodDisplayLine = {
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
    if (row.status === "CANCELLED") continue;
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
  for (const method of sortMethodKeys([...raw.keys()])) {
    const acc = raw.get(method);
    if (!acc || (acc.ils <= 0.005 && acc.usd <= 0.005)) continue;
    out.push({
      method,
      label: ledgerPaymentMethodLabel(method),
      amountIls: acc.ils > 0.005 ? acc.ils.toFixed(2) : null,
      amountUsd: acc.usd.toFixed(2),
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
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  notes: string | null;
  status: PaymentRecordStatus;
};

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

  const bucketMap = mergeBucketMaps(
    fromNotes,
    notesHaveMethodBreakdown(notes) ? new Map() : bucketsFromBatchRows(batchRows),
  );

  const checkUsd = checkAmountUsdByPaymentId?.get(primary.id) ?? 0;
  if (checkUsd > 0.005) {
    addBucket(bucketMap, "CHECK", { usd: checkUsd });
  }

  let totalUsd = 0;
  for (const row of batchRows) {
    if (row.status === "CANCELLED") continue;
    totalUsd += paymentRowUsdEquivalent(row);
  }
  totalUsd = roundMoney2(totalUsd);

  if (bucketMap.size === 0 && totalUsd > 0.005) {
    addBucket(bucketMap, defaultMethod, { usd: totalUsd });
  }

  const totalIlsN = sumBatchIls(batchRows);
  const orders = mergeOrderAllocations(batchRows, orderNumberById);
  const checks = checksByPaymentId?.get(primary.id) ?? [];

  return {
    paymentCode,
    totalUsd: totalUsd.toFixed(2),
    totalIls: totalIlsN > 0.005 ? totalIlsN.toFixed(2) : null,
    methods: sortedMethodBuckets(bucketMap),
    checks,
    orders,
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
          label: `צ'ק ${c.checkNumber}`,
          amountIls: null,
          amountUsd: c.amountUsd,
        });
      }
      continue;
    }
    out.push({
      label: m.label,
      amountIls: m.amountIls,
      amountUsd: m.amountUsd,
    });
  }

  if (hasChecks && !detail.methods.some((m) => m.method === "CHECK")) {
    for (const c of detail.checks) {
      out.push({
        label: `צ'ק ${c.checkNumber}`,
        amountIls: null,
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
  if (lines.length > 1) return true;
  if (lines.length === 1) {
    const only = lines[0];
    return only.amountIls != null && Number(only.amountIls) > 0.005;
  }
  return false;
}

export function formatLedgerPaymentDetailLines(detail: LedgerPaymentDetail | undefined | null): string[] {
  if (!detail) return [];
  const totalDisp = formatLedgerAmountDisplay(detail.totalIls, detail.totalUsd);
  const lines: string[] = [`${detail.paymentCode} · סה״כ ${totalDisp.singleLine}`];
  for (const m of ledgerPaymentMethodDisplayLines(detail)) {
    const disp = formatLedgerAmountDisplay(m.amountIls, m.amountUsd);
    lines.push(`↳ ${m.label}: ${disp.singleLine}`);
  }
  for (const o of detail.orders) {
    lines.push(`${o.orderNumber} → $${o.amountUsd}`);
  }
  return lines;
}

export function formatLedgerPaymentDetailMultiline(detail: LedgerPaymentDetail | undefined | null): string {
  return formatLedgerPaymentDetailLines(detail).join("\n");
}
