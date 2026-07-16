"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { assertCreatedByUserExists, SessionUserInvalidError } from "@/lib/session-user-guard";
import { executePaymentIntake } from "@/lib/payment-intake-rebuild/execute-payment-intake";
import type { IntakeSaveInput } from "@/lib/payment-intake-rebuild/types";

export type SavePaymentIntakeV2Result =
  | {
      ok: true;
      saved: {
        primaryPaymentCode: string;
        primaryPaymentId: string;
        count: number;
        customerBalanceUsd: string;
        compareMode: "under" | "equal" | "over";
      };
    }
  | { ok: false; error: string };

export async function savePaymentIntakeV2Action(
  input: IntakeSaveInput,
): Promise<SavePaymentIntakeV2Result> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["receive_payments"])) {
      return { ok: false, error: "אין הרשאה לקליטת תשלום" };
    }
    await assertCreatedByUserExists(me.id);

    const result = await executePaymentIntake({ userId: me.id, input });
    if (!result.ok) return result;
    return {
      ok: true,
      saved: {
        primaryPaymentCode: result.primaryPaymentCode,
        primaryPaymentId: result.primaryPaymentId,
        count: result.count,
        customerBalanceUsd: result.customerBalanceUsd,
        compareMode: result.compareMode,
      },
    };
  } catch (e) {
    if (e instanceof SessionUserInvalidError) {
      return { ok: false, error: "משתמש לא תקין — התחברו מחדש" };
    }
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }
}
