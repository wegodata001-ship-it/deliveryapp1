import { roundOrderMoney2 } from "@/lib/order-remaining-debt";

export type LedgerRunningKind = "CHARGE" | "PAYMENT" | "WITHDRAWAL" | "SKIP";

export type LedgerRunningStep = {
  kind: LedgerRunningKind;
  /** סכום מוחלט — חיוב / תשלום / משיכה */
  amountUsd: number;
};

export type LedgerRunningReplay = {
  /** יתרה אחרי כל שורה, באותו סדר כמו הקלט */
  balances: number[];
  /** משיכה שעדיין לא נסגרה מול חוב נותר */
  pendingWithdrawalUsd: number;
};

/**
 * Replay חוב פתוח בכרטסת.
 * משיכה מחוב סוגרת רק יתרה חיובית — לא יוצרת זכות ולא יתרה שלילית.
 * עודף משיכה נשמר כ-pending ונסגר אחרי תשלומים / בסוף הריצה.
 */
export function replayCustomerLedgerRunning(
  steps: LedgerRunningStep[],
  openingBalanceUsd = 0,
): LedgerRunningReplay {
  let running = roundOrderMoney2(openingBalanceUsd);
  let pendingWithdrawal = 0;
  const balances: number[] = [];

  const consumePending = () => {
    if (pendingWithdrawal <= 0 || running <= 0) return;
    const applied = Math.min(running, pendingWithdrawal);
    running = roundOrderMoney2(running - applied);
    pendingWithdrawal = roundOrderMoney2(pendingWithdrawal - applied);
  };

  for (const step of steps) {
    const amount = roundOrderMoney2(Math.abs(Number(step.amountUsd) || 0));
    if (step.kind === "CHARGE") {
      running = roundOrderMoney2(running + amount);
    } else if (step.kind === "PAYMENT") {
      running = roundOrderMoney2(running - amount);
      consumePending();
    } else if (step.kind === "WITHDRAWAL") {
      pendingWithdrawal = roundOrderMoney2(pendingWithdrawal + amount);
    }
    balances.push(roundOrderMoney2(running));
  }

  consumePending();
  if (balances.length > 0) {
    balances[balances.length - 1] = roundOrderMoney2(running);
  }

  return { balances, pendingWithdrawalUsd: pendingWithdrawal };
}
