/**
 * BankTransactionService — תנועות בנק (משיכות / הפקדות / העברות).
 * כרגע: ערכי ברירת מחדל. בעתיד: חיבור לטבלת תנועות בנק.
 */

import { futureLoadBankMovements } from "@/lib/flow-control/services/flow-future-hooks";

export type FlowWeekBankTransactions = {
  withdrawalsIls: number;
  depositsIls: number;
  transfersToBankIls: number;
  /** תנועות גולמיות — לעתיד */
  movements: Array<{ id: string; type: string; amountIls: number; date: string }>;
};

export async function loadFlowWeekBankTransactions(weekCode: string): Promise<FlowWeekBankTransactions> {
  const movements = await futureLoadBankMovements(weekCode);
  let withdrawalsIls = 0;
  let depositsIls = 0;
  for (const m of movements) {
    if (m.type === "WITHDRAWAL" || m.type === "TRANSFER_OUT") withdrawalsIls += m.amountIls;
    if (m.type === "DEPOSIT" || m.type === "TRANSFER_IN") depositsIls += m.amountIls;
  }
  return {
    withdrawalsIls: Math.round(withdrawalsIls * 100) / 100,
    depositsIls: Math.round(depositsIls * 100) / 100,
    transfersToBankIls: 0,
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      amountIls: m.amountIls,
      date: m.date,
    })),
  };
}
