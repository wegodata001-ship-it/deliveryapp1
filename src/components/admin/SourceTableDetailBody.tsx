"use client";

import dynamic from "next/dynamic";
import type { SourceTableId } from "@/lib/source-table-definitions";

const PaymentChecksTableClient = dynamic(
  () => import("@/components/admin/PaymentChecksTableClient").then((m) => ({ default: m.PaymentChecksTableClient })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const OrderStatusesManager = dynamic(
  () => import("@/components/admin/OrderStatusesManager").then((m) => ({ default: m.OrderStatusesManager })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const SourceTableProClient = dynamic(
  () => import("@/components/admin/SourceTableProClient").then((m) => ({ default: m.SourceTableProClient })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

type Props = {
  tableId: SourceTableId;
  initialSearch: string;
};

export function SourceTableDetailBody({ tableId, initialSearch }: Props) {
  if (tableId === "payment-checks") {
    return <PaymentChecksTableClient />;
  }
  if (tableId === "statuses") {
    return <OrderStatusesManager initialSearch={initialSearch} />;
  }
  return <SourceTableProClient tableId={tableId} initialData={null} initialSearch={initialSearch} />;
}
