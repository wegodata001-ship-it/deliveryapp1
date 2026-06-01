"use client";

import dynamic from "next/dynamic";
import type { CustomerCardSnapshot } from "@/app/admin/capture/actions";

const CustomerCardWindowBody = dynamic(
  () =>
    import("@/components/admin/AdminWindowBodies").then((m) => ({
      default: m.CustomerCardWindowBody,
    })),
  {
    loading: () => (
      <div className="adm-customer-card-page" aria-busy="true">
        <p className="adm-win-meta">טוען כרטסת…</p>
      </div>
    ),
  },
);

type Props = {
  customerId: string | null;
  customerName: string | null;
  initialTab: "details" | "ledger";
  initialSnap: CustomerCardSnapshot | null;
};

/** כרטסת לקוח — מסך מלא; נתונים ראשוניים מגיעים מהשרת כשיש customerId */
export function CustomerCardPageClient({ customerId, customerName, initialTab, initialSnap }: Props) {
  return (
    <div className="adm-customer-card-page">
      <CustomerCardWindowBody
        customerId={customerId}
        customerName={customerName}
        initialTab={initialTab}
        initialSnap={initialSnap}
      />
    </div>
  );
}
