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
    try {
      const next = await getActivityDashboardAction();
      setPayload(next);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="adm-activity-page adm-page--page-scroll">
      <section className="adm-activity-hero">
        <div>
          <h1>יומן פעילות</h1>
          <p>
            מעקב בזמן אמת: מי פעיל במערכת, פעולות אחרונות ולוג פעילות (חלון פעילות: 15 דקות).
          </p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => void refresh()} disabled={loading}>
          רענון
        </button>
      </section>

      <section className="adm-activity-kpis" aria-busy={loading}>
        <div className="adm-activity-kpi adm-activity-kpi--today">
          <span>סה״כ משתמשים</span>
          <strong>{payload.kpis.total}</strong>
        </div>
        <div className="adm-activity-kpi adm-activity-kpi--now">
          <span>פעילים עכשיו</span>
          <strong>{payload.kpis.activeNow}</strong>
        </div>
        <div className="adm-activity-kpi adm-activity-kpi--inactive">
          <span>לא פעילים</span>
          <strong>{payload.kpis.inactive}</strong>
        </div>
      </section>

      <section className="adm-activity-table-wrap">
        <h2 className="adm-activity-section-title">משתמשים במערכת</h2>
        <table className="adm-table adm-activity-table">
          <thead>
            <tr>
              <th>משתמש</th>
              <th>תפקיד</th>
              <th>סטטוס</th>
              <th>פעילות אחרונה</th>
            </tr>
          </thead>
          <tbody>
            {payload.users.length === 0 ? (
              <tr>
                <td colSpan={4} className="adm-table-empty">
                  אין משתמשים להצגה.
                </td>
              </tr>
            ) : (
              payload.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.userName}</td>
                  <td>{user.role}</td>
                  <td>
                    <span
                      className={`adm-activity-status adm-activity-status--${user.status === "ACTIVE" ? "active" : "inactive"}`}
                    >
                      {user.statusLabel}
                    </span>
                  </td>
                  <td>{user.lastActivityLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="adm-activity-table-wrap">
        <h2 className="adm-activity-section-title">לוג פעילות</h2>
        <table className="adm-table adm-activity-table adm-activity-log-table">
          <thead>
            <tr>
              <th>שעה</th>
              <th>משתמש</th>
              <th>פעולה</th>
            </tr>
          </thead>
          <tbody>
            {payload.logs.length === 0 ? (
              <tr>
                <td colSpan={3} className="adm-table-empty">
                  אין פעולות רשומות עדיין. פעולות חדשות יופיעו כאן אוטומטית.
                </td>
              </tr>
            ) : (
              payload.logs.map((log) => (
                <tr key={log.id}>
                  <td dir="ltr">{log.timeLabel}</td>
                  <td>{log.userName}</td>
                  <td>{log.actionLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
