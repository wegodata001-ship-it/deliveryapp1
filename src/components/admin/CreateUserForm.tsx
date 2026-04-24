"use client";

import "@/components/workflows/workflow.css";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createUserAction, type FormState } from "@/app/admin/users/actions";
import { EMPLOYEE_PERMISSION_GROUPS } from "@/lib/employee-permission-groups";

const initial: FormState = { error: null };

export function CreateUserForm({ permissionByKey }: { permissionByKey: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(createUserAction, initial);
  const [roleUi, setRoleUi] = useState<"EMPLOYEE" | "ADMIN">("EMPLOYEE");

  return (
    <form className="adm-form" action={formAction}>
      {state.error ? <div className="adm-error">{state.error}</div> : null}

      <div className="adm-field">
        <label htmlFor="fullName">שם מלא</label>
        <input id="fullName" name="fullName" type="text" required autoComplete="name" />
      </div>

      <div className="adm-field">
        <label htmlFor="username">שם משתמש</label>
        <input id="username" name="username" type="text" required autoComplete="username" />
        <div className="adm-field-hint">אותיות לטיניות, מספרים, קו תחתון או נקודה</div>
      </div>

      <div className="adm-field">
        <label htmlFor="password">סיסמה</label>
        <input id="password" name="password" type="password" required autoComplete="new-password" minLength={8} />
        <div className="adm-field-hint">לפחות 8 תווים</div>
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
          <input type="checkbox" name="isActive" value="true" defaultChecked />
          <span>משתמש פעיל</span>
        </label>
      </div>

      {roleUi === "ADMIN" ? (
        <div className="wf-note" style={{ marginTop: "0.5rem" }}>
          מנהל מערכת נכנס לכל המסכים והפעולות. אין צורך לבחור הרשאות נפרדות.
        </div>
      ) : (
        <div className="adm-field" style={{ marginTop: "1rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>הרשאות לעובד</span>
          <div className="adm-field-hint">סימון לפי תחומי אחריות בעבודה השוטפת</div>
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
                      <input type="checkbox" name="permissionIds" value={id} />
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
            "שמירה"
          )}
        </button>
        <Link href="/admin/users" className="adm-btn adm-btn--ghost">
          ביטול
        </Link>
      </div>
    </form>
  );
}
