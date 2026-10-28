"use client";

import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";
import { TURKEY_MOVEMENT_TYPE_LABELS } from "@/lib/flow-control/turkey-transfer-balance-types";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

export function TurkeyMovementDocuments({
  movements,
  weekCode,
}: {
  movements: TurkeyTransferMovementDto[];
  weekCode: string;
}) {
  const rows = movements.filter((m) => m.weekCode === weekCode);
  if (rows.length === 0) return null;

  return (
    <section className="cfc-turkey-docs" aria-label="מסמכי העברות לטורקיה">
      <h4>אישורי העברה לפי תנועה</h4>
      <ul className="cfc-turkey-docs__list">
        {rows.map((m) => (
          <li key={m.id} className="cfc-turkey-docs__item">
            <div className="cfc-turkey-docs__meta">
              <span>{TURKEY_MOVEMENT_TYPE_LABELS[m.type]}</span>
              <strong dir="ltr">
                {fmtDailyMoney(m.currency, Math.abs(m.signedAmount))}
              </strong>
              <span dir="ltr" className="cfc-muted">
                {m.createdAtDisplay}
              </span>
            </div>
            <DocumentsPanel
              entityType="TURKEY_TRANSFER"
              entityId={m.id}
              title="מסמכים"
              selfResolvePermissions
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
