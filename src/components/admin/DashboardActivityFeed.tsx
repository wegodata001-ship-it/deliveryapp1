import { Pencil, ShoppingCart, UserPlus, Wallet } from "lucide-react";
import type { DashboardActivityRow } from "@/lib/dashboard-stats";

const timeFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

function IconFor({ row }: { row: DashboardActivityRow }) {
  const common = { size: 18, strokeWidth: 1.75, "aria-hidden": true as const };
  if (row.actionType === "ORDER_UPDATED") {
    return <Pencil {...common} className="adm-activity-icon-svg" />;
  }
  switch (row.kind) {
    case "payment":
      return <Wallet {...common} className="adm-activity-icon-svg" />;
    case "customer":
      return <UserPlus {...common} className="adm-activity-icon-svg" />;
    default:
      return <ShoppingCart {...common} className="adm-activity-icon-svg" />;
  }
}

export function DashboardActivityFeed({ items }: { items: DashboardActivityRow[] }) {
  if (!items.length) {
    return <p className="adm-activity-empty">אין פעילות להצגה בטווח הנבחר.</p>;
  }

  return (
    <ul className="adm-activity-feed" aria-label="פעילות אחרונה">
      {items.map((row) => (
        <li key={row.id} className="adm-activity-item">
          <div className="adm-activity-icon" aria-hidden>
            <IconFor row={row} />
          </div>
          <div className="adm-activity-body">
            <div className="adm-activity-row1">
              <span className="adm-activity-title">{row.titleHe}</span>
              <time className="adm-activity-time" dateTime={row.createdAt.toISOString()}>
                {timeFmt.format(row.createdAt)}
              </time>
            </div>
            {row.detail ? (
              <p className="adm-activity-detail" title={row.detail}>
                {row.detail}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
