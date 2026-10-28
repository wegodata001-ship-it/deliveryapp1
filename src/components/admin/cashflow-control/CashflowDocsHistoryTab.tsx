"use client";

import Link from "next/link";
import { Archive, Camera, Upload } from "lucide-react";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import { ManagerCountHistoryPanel } from "@/components/admin/manager-count/ManagerCountHistoryPanel";
import type { WorkCountryCode } from "@/lib/work-country";

export function CashflowDocsHistoryTab({
  week,
  flow,
  workCountry,
}: {
  week: string;
  flow: FlowWeekPayload | null;
  workCountry: WorkCountryCode;
}) {
  return (
    <div className="cfc-docs-tab">
      <div className="cfc-docs-tab__actions">
        <Link className="cfc-btn cfc-btn--ghost cfc-btn--sm" href={`/admin/documents?week=${encodeURIComponent(week)}`}>
          <Archive size={14} />
          ארכיון
        </Link>
        <Link className="cfc-btn cfc-btn--ghost cfc-btn--sm" href={`/admin/documents?week=${encodeURIComponent(week)}&upload=1`}>
          <Upload size={14} />
          העלאת מסמך
        </Link>
        <Link className="cfc-btn cfc-btn--ghost cfc-btn--sm" href={`/admin/documents?week=${encodeURIComponent(week)}&camera=1`}>
          <Camera size={14} />
          צילום
        </Link>
      </div>
      {flow?.cashWeekFlowId ? (
        <DocumentsPanel
          entityType="CASH_WEEK_FLOW"
          entityId={flow.cashWeekFlowId}
          title="מסמכי שבוע"
          selfResolvePermissions
        />
      ) : (
        <p className="cfc-empty cfc-empty--inline">אין מסמכים — שמרו ספירת מנהל לצירוף קבצים.</p>
      )}
      <ManagerCountHistoryPanel week={week} workCountry={workCountry} />
    </div>
  );
}
