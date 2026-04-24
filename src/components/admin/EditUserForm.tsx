"use client";

import "@/components/workflows/workflow.css";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { updateUserAction, type FormState } from "@/app/admin/users/actions";
import { EMPLOYEE_PERMISSION_GROUPS } from "@/lib/employee-permission-groups";

const initial: FormState = { error: null };

export type EditUserSafe = {
  id: string;
  fullName: string;
  username: string | null;
  role: "ADMIN" | "EMPLOYEE";
  isActive: boolean;
  permissionIds: string[];
};

export function EditUserForm({ user, permissionByKey }: { user: EditUserSafe; permissionByKey: Record<string, string> }) {
  const boundUpdate = updateUserAction.bind(null, user.id);
  const [state, formAction, pending] = useActionState(boundUpdate, initial);
  const [roleUi, setRoleUi] = useState<"EMPLOYEE" | "ADMIN">(user.role);

  return (
    <form className="adm-form" action={formAction}>
      {state.error ? <div className="adm-error">{state.error}</div> : null}

      <div className="adm-field">
        <label htmlFor="fullName">שם מלא</label>
        <input id="fullName" name="fullName" type="text" required defaultValue={user.fullName} autoComplete="name" />
      </div>

      <div className="adm-field">
        <label htmlFor="username">שם משתמש</label>
        <input
          id="username"
          name="username"
          type="text"
          required
          defaultValue={user.username ?? ""}
          autoComplete="username"
        />
      </div>

      <div className="adm-field">
        <label htmlFor="password">סיסמה חדשה (אופציונלי)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} />
        <div className="adm-field-hint">השאר ריק כדי לשמור על הסיסמה הקיימת</div>
      </div>

      <div className="adm-field">
        <label htmlFor="role">תפקיד</label>
        <select
          id="role"
          name="role"
          required
          value={roleUi}
          onChange={(e) => setRoleUi(e.target.value as "EMPLOYEE" | "ADMIN")}
        >
          <option value="EMPLOYEE">עובד</option>
          <option value="ADMIN">מנהל מערכת</option>
        </select>
      </div>

      <div className="adm-field">
        <label className="adm-check" style={{ cursor: "pointer" }}>
          <input type="checkbox" name="isActive" value="true" defaultChecked={user.isActive} />
          <span>משתמש פעיל</span>
        </label>
      </div>

      {roleUi === "ADMIN" ? (
        <div className="wf-note" style={{ marginTop: "0.5rem" }}>
          מנהל מערכת נכנס לכל המסכים והפעולות. הרשאות נפרדות לא נשמרות עבור תפקיד זה.
        </div>
      ) : (
        <div className="adm-field" style={{ marginTop: "1rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>הרשאות לעובד</span>
          {EMPLOYEE_PERMISSION_GROUPS.map((group) => (
            <div key={group.title} style={{ marginTop: "1rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: "0.5rem", color: "var(--adm-text)" }}>
                {group.title}
              </div>
              <div className="adm-check-grid">
                {group.entries.map((entry) => {
                  const id = permissionByKey[entry.key];
                  if (!id) return null;
                  return (
                    <label key={entry.key} className="adm-check" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        name="permissionIds"
                        value={id}
                        defaultChecked={user.permissionIds.includes(id)}
                      />
                      <span>{entry.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="al-spin" size={18} />
              שומר…
            </>
          ) : (
            "עדכון"
          )}
        </button>
        <Link href="/admin/users" className="adm-btn adm-btn--ghost">
          ביטול
        </Link>
      </div>
    </form>
  );
}
