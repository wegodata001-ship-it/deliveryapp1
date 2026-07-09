"use client";

import { Eye, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import type { CashDailyExpenseRowDto } from "@/app/admin/cash-control/daily-types";
import { num } from "@/components/admin/cash-flow/shared";

export type CashExpensesSectionCaps = {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canView?: boolean;
};

export type CashExpensesSectionProps = {
  expenses: CashDailyExpenseRowDto[];
  expensesIls: string;
  expensesUsd: string;
  caps: CashExpensesSectionCaps;
  busy: string | null;
  onAdd: () => void;
  onEdit: (row: CashDailyExpenseRowDto) => void;
  onDelete: (id: string) => void;
};

/** אזור 5 — הוצאות קופה (אדום) */
export function CashExpensesSection({
  expenses,
  expensesIls,
  expensesUsd,
  caps,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: CashExpensesSectionProps) {
  return (
    <section className="cc-block cc-block--expense cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--red" aria-hidden />
          הוצאות קופה
        </div>
        <div className="cc-block__head-actions">
          <span className="cc-block__note">
            סה"כ: <strong dir="ltr">{fmtDailyMoney("ILS", num(expensesIls))}</strong>
            {num(expensesUsd) > 0 ? (
              <> · <strong dir="ltr">{fmtDailyMoney("USD", num(expensesUsd))}</strong></>
            ) : null}
          </span>
          {caps.canCreate ? (
            <button type="button" className="cc-btn cc-btn--danger cc-btn--sm" onClick={onAdd}>
              <Plus size={14} /> הוצאה חדשה
            </button>
          ) : null}
        </div>
      </header>
      {expenses.length === 0 ? (
        <p className="cc-empty">אין הוצאות קופה ביום זה</p>
      ) : (
        <div className="cc-block__scroll">
          <table className="cc-table cc-table--expense">
            <thead>
              <tr>
                <th>שעה</th>
                <th>סוג הוצאה</th>
                <th>תיאור</th>
                <th className="cc-num">סכום</th>
                <th>מטבע</th>
                <th>עובד שהזין</th>
                <th>מסמך</th>
                <th>סטטוס</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td dir="ltr">{e.timeHm}</td>
                  <td>{e.reasonLabel}</td>
                  <td>{e.notes ?? "—"}</td>
                  <td dir="ltr" className="cc-num">{fmtDailyMoney(e.currency, num(e.amount))}</td>
                  <td>{e.currency === "USD" ? "$ דולר" : "₪ שקל"}</td>
                  <td>{e.createdByName ?? "—"}</td>
                  <td className="cc-icon-cell">
                    {e.documentCount > 0 ? (
                      <span className="cc-doc-badge">
                        <Paperclip size={13} aria-hidden /> {e.documentCount}
                      </span>
                    ) : (
                      <span className="cc-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="cc-badge is-ok">פעיל</span>
                  </td>
                  <td className="cc-icon-cell">
                    <div className="cc-row-actions">
                      <button
                        type="button"
                        className="cc-iconbtn"
                        title="צפייה / עריכה"
                        onClick={() => onEdit(e)}
                        disabled={!caps.canEdit && !caps.canView}
                      >
                        {caps.canEdit ? <Pencil size={14} /> : <Eye size={14} />}
                      </button>
                      {caps.canDelete ? (
                        <button
                          type="button"
                          className="cc-iconbtn cc-iconbtn--danger"
                          title="מחיקה"
                          disabled={busy === e.id}
                          onClick={() => onDelete(e.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default CashExpensesSection;
