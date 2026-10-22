import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";
import { formatLedgerActorDisplay } from "@/lib/ledger-actor-display";
import { balanceResetSourceLabelHe } from "@/lib/ledger-balance-reset";
import {
  ledgerPaymentExpandLines,
  shouldShowLedgerPaymentMethodSubrows,
} from "@/lib/ledger-payment-detail";
import { formatLedgerPaymentTotalUsd } from "@/lib/ledger-payment-display";
import { formatMoneyAmount, parseMoneyStringOrZero } from "@/lib/money-format";
import { surplusDestinationLabelHe } from "@/lib/payment-reconciliation-ssot";
import { formatHmJerusalem, formatYmdJerusalem } from "@/lib/weeks/ah-week";

export type LedgerDetailField = {
  label: string;
  value: string;
};

export type LedgerRowDetailView = {
  title: string;
  dateYmd: string;
  fields: LedgerDetailField[];
  openPaymentId: string | null;
  openOrderId: string | null;
};

function money(value: string | null | undefined): string {
  return `$${formatMoneyAmount(parseMoneyStringOrZero(value ?? "0"), 2)}`;
}

function moneyArrow(before: string | null | undefined, after: string | null | undefined): string | null {
  if (before == null && after == null) return null;
  if (before == null) return money(after);
  if (after == null) return money(before);
  return `${money(before)} → ${money(after)}`;
}

function displayDate(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function push(fields: LedgerDetailField[], label: string, value: string | null | undefined): void {
  const t = (value ?? "").trim();
  if (!t || t === "—") return;
  fields.push({ label, value: t });
}

export function hasLedgerRowDetail(row: CustomerLedgerRow): boolean {
  if (row.kind === "OPENING_BALANCE") return false;
  if (row.kind === "BALANCE_RESET" || row.isBalanceReset) return true;
  if (row.isOrderUpdated || row.isCommissionDebtClosure) return true;
  if (row.isPaymentCancelled || row.isOrderCancelled) return true;
  if (row.isAdjustmentFeeCapture) return true;
  if (row.kind === "PAYMENT" && (row.paymentDetail || row.paymentReconciliation)) return true;
  return false;
}

export function buildLedgerRowDetailView(row: CustomerLedgerRow): LedgerRowDetailView {
  const fields: LedgerDetailField[] = [];
  const title = row.typeLabel?.trim() || row.document || "פירוט תנועה";

  if (row.isBalanceReset || row.kind === "BALANCE_RESET") {
    const d = row.balanceResetDetail;
    if (d) {
      push(fields, "סכום שאופס", money(d.amountResetUsd));
      const creditChanged =
        d.creditBeforeUsd != null ||
        d.creditAfterUsd != null;
      if (creditChanged) {
        const credit = moneyArrow(d.creditBeforeUsd ?? "0.00", d.creditAfterUsd ?? "0.00");
        if (credit) push(fields, "יתרת זכות", credit);
      }
      const debtBefore = parseMoneyStringOrZero(d.openDebtBeforeUsd ?? "0");
      const debtAfter = parseMoneyStringOrZero(d.openDebtAfterUsd ?? "0");
      if (d.openDebtBeforeUsd != null || d.openDebtAfterUsd != null) {
        if (debtBefore > 0.005 || debtAfter > 0.005) {
          const debt = moneyArrow(d.openDebtBeforeUsd ?? "0.00", d.openDebtAfterUsd ?? "0.00");
          if (debt) push(fields, "חוב פתוח", debt);
        }
      }
      const fees = moneyArrow(d.commissionBeforeUsd, d.commissionAfterUsd);
      if (fees) {
        push(fields, "יתרת עמלות", fees);
      } else {
        const plain = moneyArrow(d.amountBeforeUsd, d.amountAfterUsd);
        if (plain) push(fields, "יתרה", plain);
      }
      push(fields, "בוצע על ידי", formatLedgerActorDisplay(d.performedBy));
      push(fields, "תאריך", displayDate(row.dateYmd));
      push(fields, "סוג פעולה", balanceResetSourceLabelHe(d.source));
    }
  } else if (row.isOrderUpdated && row.orderUpdateDetail) {
    const d = row.orderUpdateDetail;
    for (const change of d.changes) {
      push(fields, change.label, `${change.before} → ${change.after}`);
      if (change.deltaUsd) push(fields, "שינוי", change.deltaUsd);
    }
    push(fields, "אושר על ידי", formatLedgerActorDisplay(d.approvedBy));
    if (d.requestedBy && d.requestedBy !== "—") {
      push(fields, "מבקש", formatLedgerActorDisplay(d.requestedBy));
    }
    push(fields, "תאריך", displayDate(row.dateYmd));
  } else if (row.isCommissionDebtClosure) {
    const orderBal = moneyArrow(row.orderBalanceBeforeUsd, row.orderBalanceAfterUsd);
    if (orderBal) push(fields, "יתרת הזמנה", orderBal);
    const fees = moneyArrow(row.commissionBeforeUsd, row.commissionAfterUsd);
    if (fees) push(fields, "יתרת עמלה", fees);
    push(fields, "תאריך", displayDate(row.dateYmd));
  } else if (row.isOrderCancelled && row.orderCancelDetail) {
    const d = row.orderCancelDetail;
    push(fields, "מספר הזמנה", d.orderNumber);
    push(fields, "סכום שבוטל", money(d.amountUsd));
    const bal = moneyArrow(
      d.balanceBeforeUsd === "—" ? null : d.balanceBeforeUsd,
      d.balanceAfterUsd === "—" ? null : d.balanceAfterUsd,
    );
    if (bal) push(fields, "יתרה", bal);
    push(fields, "אושר על ידי", formatLedgerActorDisplay(d.approvedBy));
    if (d.reason?.trim()) push(fields, "סיבה", d.reason.trim());
    push(fields, "תאריך", displayDate(row.dateYmd));
  } else if (row.kind === "PAYMENT" && (row.paymentReconciliation || row.paymentDetail)) {
    const recon = row.paymentReconciliation;
    const detail = row.paymentDetail;
    if (recon) {
      push(fields, "חוב לפני התשלום", money(recon.openDebtBefore.toFixed(2)));
      push(fields, "התקבל", money(recon.receivedAmount.toFixed(2)));
      push(fields, "נסגר מהחוב", money(recon.appliedToDebt.toFixed(2)));
      if (recon.surplusAmount > 0.005) {
        push(fields, "עודף", money(recon.surplusAmount.toFixed(2)));
        const dest = surplusDestinationLabelHe(recon.surplusDestination);
        if (dest) push(fields, "הועבר ל", dest);
      }
      push(fields, "חוב פתוח אחרי", money(recon.openDebtAfter.toFixed(2)));
    } else if (detail) {
      push(fields, "התקבל", formatLedgerPaymentTotalUsd(detail.totalUsd));
    }
    if (detail && shouldShowLedgerPaymentMethodSubrows(detail)) {
      for (const line of ledgerPaymentExpandLines(detail)) {
        push(fields, line.label, line.display);
      }
    }
    if (row.paymentWeekCode) push(fields, "שבוע עבודה", row.paymentWeekCode);
    push(fields, "תאריך עסקי", displayDate(row.dateYmd));
    if (row.intakeAtIso) {
      const at = new Date(row.intakeAtIso);
      if (!Number.isNaN(at.getTime())) {
        push(fields, "מועד קליטה בפועל", `${displayDate(formatYmdJerusalem(at))} ${formatHmJerusalem(at)}`);
      }
    }
  } else if (row.isAdjustmentFeeCapture) {
    push(fields, "סכום", formatLedgerPaymentTotalUsd(row.paymentUsd));
    push(fields, "תאריך", displayDate(row.dateYmd));
  }

  return {
    title,
    dateYmd: row.dateYmd,
    fields,
    openPaymentId: row.paymentId,
    openOrderId: row.orderId,
  };
}
