const EPS = 0.01;

export type CustomerAccountStatusKind = "debt" | "credit" | "even";

export function classifyCustomerAccountStatus(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): CustomerAccountStatusKind {
  if (balances.openDebtUsd > EPS) return "debt";
  if (balances.availableCreditUsd > EPS) return "credit";
  return "even";
}

export function customerAccountStatusLabel(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): string {
  const kind = classifyCustomerAccountStatus(balances);
  if (kind === "debt") return "חוב פתוח";
  if (kind === "credit") {
    return `יתרת זכות $${balances.availableCreditUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return "מאוזן";
}

/** חיובי = חוב; שלילי = יתרת זכות. לא clamp. */
export function customerAccountSignedUsd(balances: {
  openDebtUsd: number;
  availableCreditUsd: number;
}): number {
  if (balances.openDebtUsd > EPS) return Math.round((balances.openDebtUsd + Number.EPSILON) * 100) / 100;
  if (balances.availableCreditUsd > EPS) {
    return Math.round((-balances.availableCreditUsd + Number.EPSILON) * 100) / 100;
  }
  return 0;
}
