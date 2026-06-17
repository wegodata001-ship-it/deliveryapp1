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

const CustomersSourceTableClient = dynamic(
  () =>
    import("@/components/admin/CustomersSourceTableClient").then((m) => ({
      default: m.CustomersSourceTableClient,
    })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const OrdersSourceTableClient = dynamic(
  () =>
    import("@/components/admin/OrdersSourceTableClient").then((m) => ({
      default: m.OrdersSourceTableClient,
    })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const PaymentsSourceTableClient = dynamic(
  () =>
    import("@/components/admin/PaymentsSourceTableClient").then((m) => ({
      default: m.PaymentsSourceTableClient,
    })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const EmployeesSourceTableClient = dynamic(
  () =>
    import("@/components/admin/EmployeesSourceTableClient").then((m) => ({
      default: m.EmployeesSourceTableClient,
    })),
  { loading: () => <div className="adm-source-pro adm-source-pro--shell" aria-busy="true" /> },
);

const PaymentMethodsManager = dynamic(
  () => import("@/components/admin/PaymentMethodsManager").then((m) => ({ default: m.PaymentMethodsManager })),
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
  if (tableId === "customers") {
    return <CustomersSourceTableClient initialSearch={initialSearch} />;
  }
  if (tableId === "orders") {
    return <OrdersSourceTableClient initialSearch={initialSearch} />;
  }
  if (tableId === "payments") {
    return <PaymentsSourceTableClient initialSearch={initialSearch} />;
  }
  if (tableId === "employees") {
    return <EmployeesSourceTableClient initialSearch={initialSearch} />;
  }
  if (tableId === "payment-methods") {
    return <PaymentMethodsManager initialSearch={initialSearch} />;
  }
  return <SourceTableProClient tableId={tableId} initialData={null} initialSearch={initialSearch} />;
}
