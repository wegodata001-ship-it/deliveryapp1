"use client";

import { useCallback, useState } from "react";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { PaymentModalUpdated } from "@/components/admin/PaymentModalUpdated";

type Props = {
  financial: SerializedFinancial | null;
  viewerIsAdmin?: boolean;
};

export function PaymentsUpdatedClient({ financial, viewerIsAdmin = false }: Props) {
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
      <PaymentModalUpdated financial={financial} onToast={onToast} viewerIsAdmin={viewerIsAdmin} />
      {toast ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

