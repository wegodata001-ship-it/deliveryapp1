"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { formatUsdDisplay } from "@/lib/money-format";
import {
  WORKSPACE_ORDER_STATUS_LABELS,
  type CustomerWorkspaceComputedStats,
  type WorkspaceOrderStatusKey,
} from "@/lib/customer-workspace-stats";

const STATUS_ORDER: WorkspaceOrderStatusKey[] = [
  "ready",
  "open",
  "cancelled",
  "debtWithdrawal",
  "inProgress",
];

type Props = {
  open: boolean;
  onClose: () => void;
  stats: CustomerWorkspaceComputedStats;
};

export function CustomerWorkspaceStatsModal({ open, onClose, stats }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="adm-cust-ws-stats-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="adm-cust-ws-stats-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cust-ws-stats-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="adm-cust-ws-stats-drawer__head">
          <h2 id="cust-ws-stats-title">סטטיסטיקת מרכז לקוחות</h2>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--dense"
            onClick={onClose}
            aria-label="סגור"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="adm-cust-ws-stats-drawer__body">
          <section className="adm-cust-ws-stats-section">
            <h3>סטטוס הזמנות</h3>
            <ul className="adm-cust-ws-stats-list">
              {STATUS_ORDER.map((key) => (
                <li key={key}>
                  <span>{WORKSPACE_ORDER_STATUS_LABELS[key]}</span>
                  <strong>{stats.byStatus[key].count.toLocaleString("he-IL")}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="adm-cust-ws-stats-section">
            <h3>סכומים לפי סטטוס</h3>
            <ul className="adm-cust-ws-stats-list adm-cust-ws-stats-list--money">
              {STATUS_ORDER.map((key) => (
                <li key={key}>
                  <span>{WORKSPACE_ORDER_STATUS_LABELS[key]}</span>
                  <strong dir="ltr">{formatUsdDisplay(stats.byStatus[key].amountUsd)}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="adm-cust-ws-stats-section">
            <h3>לקוחות</h3>
            <ul className="adm-cust-ws-stats-list">
              <li>
                <span>לקוחות בחוב</span>
                <strong>{stats.customersDebtCount.toLocaleString("he-IL")}</strong>
              </li>
              <li>
                <span>לקוחות בזכות</span>
                <strong>{stats.customersCreditCount.toLocaleString("he-IL")}</strong>
              </li>
              <li>
                <span>לקוחות מאוזנים</span>
                <strong>{stats.customersBalancedCount.toLocaleString("he-IL")}</strong>
              </li>
            </ul>
          </section>

          <section className="adm-cust-ws-stats-section adm-cust-ws-stats-section--totals">
            <h3>סיכומים</h3>
            <ul className="adm-cust-ws-stats-list adm-cust-ws-stats-list--money">
              <li>
                <span>{'סה"כ הזמנות לפני עמלה'}</span>
                <strong dir="ltr">{formatUsdDisplay(stats.ordersBeforeCommissionUsd)}</strong>
              </li>
              <li>
                <span>{'סה"כ הזמנות אחרי עמלה'}</span>
                <strong dir="ltr">{formatUsdDisplay(stats.ordersAfterCommissionUsd)}</strong>
              </li>
              <li>
                <span>{'סה"כ תשלומים'}</span>
                <strong dir="ltr">{formatUsdDisplay(stats.paymentsTotalUsd)}</strong>
              </li>
              <li>
                <span>{'סה"כ יתרות'}</span>
                <strong dir="ltr">{formatUsdDisplay(stats.balancesTotalUsd)}</strong>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
