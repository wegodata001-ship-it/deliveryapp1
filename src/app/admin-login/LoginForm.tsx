"use client";

import { useActionState } from "react";
import { Loader2, Lock, User } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = { error: null };

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form className="al-form" action={formAction}>
      <input type="hidden" name="next" value={nextPath} />
      {state.error ? <div className="al-error">{state.error}</div> : null}
      <div className="al-field">
        <label htmlFor="username">שם משתמש</label>
        <div className="al-input-wrap">
          <User size={18} aria-hidden />
          <input id="username" name="username" type="text" autoComplete="username" required />
        </div>
      </div>
      <div className="al-field">
        <label htmlFor="password">סיסמה</label>
        <div className="al-input-wrap">
          <Lock size={18} aria-hidden />
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      </div>
      <button className="al-submit" type="submit" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="al-spin" size={18} />
            מתחבר…
          </>
        ) : (
          "כניסה"
        )}
      </button>
    </form>
  );
}
