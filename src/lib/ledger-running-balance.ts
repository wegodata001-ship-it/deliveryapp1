/**
 * חיבור קבלה פנימית של איפוס יתרה לשרשור הכרטסת.
 * הקבלה לא מוצגת כתשלום נוסף, כי שורת האיפוס כבר מתארת אותה.
 * אם השורה אופסה ל־0 בגלל audit של עמלה, הסכום חוזר פעם אחת.
 */

const EPS = 0.01;

export type RunningResetCandidate = {
  dateMs: number;
  displayUsd: number;
  runningUsd: number;
  affectsRunning: boolean;
  isBalanceReset: boolean;
};

export type SkippedBalanceResetReceipt = {
  dateMs: number;
  amountUsd: number;
};

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

function utcDay(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

export function bindSkippedBalanceResetReceipts(
  rows: RunningResetCandidate[],
  receipts: SkippedBalanceResetReceipt[],
): { boundIndexes: number[]; unbound: SkippedBalanceResetReceipt[] } {
  const used = new Set<number>();
  const unbound: SkippedBalanceResetReceipt[] = [];

  for (const receipt of receipts) {
    if (!(receipt.amountUsd > EPS)) continue;
    const alreadyApplied = rows.some(
      (row, index) =>
        !used.has(index) &&
        row.isBalanceReset &&
        row.affectsRunning &&
        row.runningUsd > EPS &&
        sameMoney(row.runningUsd, receipt.amountUsd),
    );
    if (alreadyApplied) {
      const index = rows.findIndex(
        (row, rowIndex) =>
          !used.has(rowIndex) &&
          row.isBalanceReset &&
          row.affectsRunning &&
          sameMoney(row.runningUsd, receipt.amountUsd),
      );
      if (index >= 0) used.add(index);
      continue;
    }

    let best = -1;
    let bestSameDay = false;
    let bestDistance = Number.POSITIVE_INFINITY;
    const receiptDay = utcDay(receipt.dateMs);
    rows.forEach((row, index) => {
      if (used.has(index) || !row.isBalanceReset) return;
      if (row.affectsRunning && row.runningUsd > EPS) return;
      if (!sameMoney(row.displayUsd, receipt.amountUsd)) return;
      const sameDay = utcDay(row.dateMs) === receiptDay;
      const distance = Math.abs(row.dateMs - receipt.dateMs);
      const better =
        best < 0 ||
        (sameDay && !bestSameDay) ||
        (sameDay === bestSameDay && distance < bestDistance);
      if (better) {
        best = index;
        bestSameDay = sameDay;
        bestDistance = distance;
      }
    });

    if (best < 0) {
      unbound.push(receipt);
      continue;
    }
    used.add(best);
    rows[best] = {
      ...rows[best],
      runningUsd: receipt.amountUsd,
      affectsRunning: true,
    };
  }

  return { boundIndexes: [...used], unbound };
}
