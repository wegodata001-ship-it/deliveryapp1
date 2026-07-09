/** ערכי enum מערכת (legacy) — נשמרים ב-DB כמזהה */
export const PM = {
  CASH: "CASH",
  BANK_TRANSFER: "BANK_TRANSFER",
  BANK_TRANSFER_DONE: "BANK_TRANSFER_DONE",
  CHECK: "CHECK",
  CREDIT: "CREDIT",
  OTHER: "OTHER",
  POINT: "POINT",
  ORDERED: "ORDERED",
  WITHDRAWAL: "WITHDRAWAL",
  WITHDRAWAL_DONE: "WITHDRAWAL_DONE",
  RECEIVED_AT_POINT: "RECEIVED_AT_POINT",
  WITH_GOODS: "WITH_GOODS",
} as const;

export const LEGACY_PAYMENT_METHOD_SLUGS: readonly string[] = Object.values(PM);

/** סידור seed ראשוני — 5 + OTHER */
export const SEED_PAYMENT_METHODS: ReadonlyArray<{
  id: string;
  nameHe: string;
  colorHex: string;
  sortOrder: number;
}> = [
  { id: PM.CASH, nameHe: "מזומן", colorHex: "#22c55e", sortOrder: 0 },
  { id: PM.BANK_TRANSFER, nameHe: "העברה בנקאית", colorHex: "#3b82f6", sortOrder: 10 },
  { id: PM.CHECK, nameHe: "צ׳ק", colorHex: "#a855f7", sortOrder: 20 },
  { id: PM.CREDIT, nameHe: "אשראי", colorHex: "#f97316", sortOrder: 30 },
  { id: PM.OTHER, nameHe: "אחר", colorHex: "#64748b", sortOrder: 40 },
];

/** מיפוי alias ישן → slug רשמי */
export const LEGACY_PAYMENT_METHOD_ALIASES: Record<string, string> = {
  BANK: PM.BANK_TRANSFER,
  bank: PM.BANK_TRANSFER,
  Bank: PM.BANK_TRANSFER,
  CREDIT_CARD: PM.CREDIT,
  CARD: PM.CREDIT,
  TRANSFER: PM.BANK_TRANSFER,
  CHECKS: PM.CHECK,
  CHEQUE: PM.CHECK,
};

export function isLegacyPaymentMethodSlug(id: string): boolean {
  return (LEGACY_PAYMENT_METHOD_SLUGS as readonly string[]).includes(id);
}

export function normalizePaymentMethodId(raw: string): string {
  const t = raw.trim();
  return LEGACY_PAYMENT_METHOD_ALIASES[t] ?? t;
}

export function displayPaymentMethodCode(id: string): string {
  if (id.startsWith("pm_")) return "מותאם";
  return id;
}
