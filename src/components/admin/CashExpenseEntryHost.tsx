"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { EmployeeExpenseEntryModal } from "@/components/admin/EmployeeExpenseEntryModal";
import { useAdminToast } from "@/components/admin/AdminNavShell";

type Props = {
  canCreate: boolean;
  canManageAll: boolean;
  currentUserId: string;
  /** compact = כפתור בכותרת; dock = פעולה מהירה בדף הבית */
  variant?: "header" | "dock";
};

export function CashExpenseEntryHost({
  canCreate,
  canManageAll,
  currentUserId,
  variant = "header",
}: Props) {
  const onToast = useAdminToast();
  const [open, setOpen] = useState(false);

  const onSaved = useCallback(() => {
    onToast("ההוצאה נשמרה בהצלחה", { variant: "success" });
  }, [onToast]);

  if (!canCreate) return null;

  const label = variant === "dock" ? "הוצאה" : "+ הוצאה";

  return (
    <>
      {variant === "dock" ? (
        <button type="button" className="adm-dash-dock__btn" onClick={() => setOpen(true)}>
          <Plus size={18} strokeWidth={2.25} aria-hidden />
          <span>{label}</span>
        </button>
      ) : (
        <button
          type="button"
          className="adm-header-expense-btn"
          onClick={() => setOpen(true)}
          title="הוספת הוצאת קופה"
        >
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          <span>{label}</span>
        </button>
      )}
      <EmployeeExpenseEntryModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={onSaved}
        currentUserId={currentUserId}
        canSelectExpenseOwner={canManageAll}
        allowDate={canManageAll}
      />
    </>
  );
}

export default CashExpenseEntryHost;
