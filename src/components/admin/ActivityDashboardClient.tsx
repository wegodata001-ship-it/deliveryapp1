"use client";

import { useEffect, useState } from "react";
import { getActivityDashboardAction, type ActivityPayload } from "@/app/admin/activity/actions";

type Props = {
  initialPayload: ActivityPayload;
};

export function ActivityDashboardClient({ initialPayload }: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const next = await getActivityDashboardAction();
    setPayload(next);
    setLoading(false);
  }

  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="adm-activity-page">
      <section className="adm-activity-hero">
        <div>
          <h1>סטטוס משתמשים</h1>
          <p>מי פעיל עכשיו ומי לא פעיל כרגע במערכת.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void refresh()} disabled={loading}>
          רענון
        </button>
      </section>

      <section className="adm-activity-kpis" aria-busy={loading}>
        <div className="adm-activity-kpi adm-activity-kpi--now">
          <span>🟢 פעילים עכשיו</span>
          <strong>{payload.kpis.active}</strong>
        </div>
        <div className="adm-activity-kpi adm-activity-kpi--inactive">
          <span>🔴 לא פעילים</span>
          <strong>{payload.kpis.inactive}</strong>
        </div>
        <div className="adm-activity-kpi adm-activity-kpi--today">
          <span>👥 סה״כ משתמשים</span>
          <strong>{payload.kpis.total}</strong>
        </div>
      </section>

      <section className="adm-activity-table-wrap">
        <table className="adm-table adm-activity-table">
          <thead>
            <tr>
              <th>משתמש</th>
              <th>תפקיד</th>
              <th>סטטוס עכשיו</th>
            </tr>
          </thead>
          <tbody>
            {payload.users.length === 0 ? (
              <tr><td colSpan={3} className="adm-table-empty">אין משתמשים להצגה.</td></tr>
            ) : (
              payload.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.userName}</td>
                  <td>{user.role}</td>
                  <td><span className={`adm-activity-status adm-activity-status--${user.status.toLowerCase()}`}>{user.statusLabel}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
