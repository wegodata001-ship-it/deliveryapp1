"use client";

import { useCallback, useState } from "react";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { PaymentModalUpdated } from "@/components/admin/PaymentModalUpdated";

type Props = {
  financial: SerializedFinancial | null;
};

export function PaymentsUpdatedClient({ financial }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const onToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  return (
    <div className="adm-page" dir="rtl">
      <div className="adm-page-head">
        <h1 className="adm-page-title">קליטת תשלום מעודכן</h1>
      </div>
      <PaymentModalUpdated financial={financial} onToast={onToast} />
      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

