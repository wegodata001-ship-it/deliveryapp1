"use server";

import { attemptLogin, safeLoginNext } from "@/lib/login-auth";

export type LoginState = { error: string | null };

/** @deprecated — הטופס משתמש ב־POST /api/auth/login */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username")?.toString() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const next = safeLoginNext(formData.get("next")?.toString());

  const result = await attemptLogin(username, password, next);
  if (!result.ok) {
    return { error: result.error };
  }
  return { error: "התחברות הצליחה — רענן את הדף." };
}
