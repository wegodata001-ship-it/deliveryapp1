export type CustomersModuleListRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  country: string;
  ordersTotalUsd: string;
  paymentsTotalUsd: string;
  balanceUsd: string;
};

export type CustomersPdfScope = "current" | "all" | "debt" | "credit";

export type CustomersModuleListResult = {
  rows: CustomersModuleListRow[];
  page: number;
  limit: number;
  hasMore: boolean;
};

export type CustomerProfileDetails = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  address: string;
  city: string;
  currency: string;
  notes: string;
  isActive: boolean;
};

export type CustomerProfileKpis = {
  ordersTotalUsd: string;
  paymentsTotalUsd: string;
  balanceUsd: string;
  dealsTotalUsd: string;
  commissionTotalUsd: string;
};

export type CustomerProfileOrderRow = {
  id: string;
  orderNumber: string;
  dateYmd: string;
  amountUsd: string;
  commissionUsd: string;
  /** יתרת הזמנה (total − שולם) */
  balanceUsd: string;
  status: string;
  statusLabel: string;
};

export type CustomerProfilePaymentRow = {
  id: string;
  paymentCode: string;
  dateYmd: string;
  amountUsd: string;
  amountIls: string;
  currencyLabel: string;
  /** ערך PaymentMethod ב-DB */
  paymentMethod: string | null;
  methodLabel: string;
  note: string;
};

export type CustomerProfilePayload = {
  customer: CustomerProfileDetails;
  kpis: CustomerProfileKpis;
  orders: CustomerProfileOrderRow[];
  payments: CustomerProfilePaymentRow[];
};

export const CUSTOMER_WORKSPACE_ROW_LIMIT = 800;

export type CustomerWorkspaceOrderRow = CustomerProfileOrderRow & {
  customerId: string;
  customerCode: string;
  customerName: string;
};

export type CustomerWorkspacePaymentRow = CustomerProfilePaymentRow & {
  customerId: string;
  customerCode: string;
  customerName: string;
};
