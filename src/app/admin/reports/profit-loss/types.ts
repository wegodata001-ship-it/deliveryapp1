export type ProfitLossFilters = {
  weekFrom?: string;
  weekTo?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  /** ספק = branch או sourceCountry */
  supplier?: string;
  city?: string;
  status?: string;
};

export type ProfitLossKpiKey =
  | "sales"
  | "cost"
  | "fx"
  | "shipping"
  | "commission"
  | "expenses"
  | "gross"
  | "net";

export type ProfitLossKpi = {
  key: ProfitLossKpiKey;
  label: string;
  valueIls: number;
  valueUsd?: number;
  hint: string;
};

export type ProfitLossOrderRow = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  supplier: string | null;
  city: string | null;
  status: string;
  statusLabel: string;
  dateYmd: string | null;
  weekCode: string | null;
  salesUsd: number;
  salesIls: number;
  costUsd: number;
  costIls: number;
  commissionUsd: number;
  commissionIls: number;
  fxProfitIls: number;
  shippingIls: number;
  expensesIls: number;
  grossIls: number;
  netIls: number;
  buyRate: number | null;
  collectRate: number | null;
  lossReason: string | null;
};

export type ProfitLossSeriesPoint = {
  key: string;
  label: string;
  salesIls: number;
  costIls: number;
  fxIls: number;
  commissionIls: number;
  shippingIls: number;
  expensesIls: number;
  grossIls: number;
  netIls: number;
  orderCount: number;
};

export type ProfitLossNamedBar = {
  key: string;
  label: string;
  salesIls: number;
  profitIls: number;
  orderCount: number;
};

export type ProfitLossFxPoint = {
  key: string;
  label: string;
  buyRate: number;
  collectRate: number;
  fxProfitIls: number;
  orderCount: number;
};

export type ProfitLossCompositionSlice = {
  key: string;
  label: string;
  valueIls: number;
};

export type ProfitLossLosingOrder = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  lossIls: number;
  reason: string;
};

export type ProfitLossDashboard = {
  filters: ProfitLossFilters;
  kpis: ProfitLossKpi[];
  orders: ProfitLossOrderRow[];
  timeline: ProfitLossSeriesPoint[];
  byCustomer: ProfitLossNamedBar[];
  bySupplier: ProfitLossNamedBar[];
  byCity: ProfitLossNamedBar[];
  fxSeries: ProfitLossFxPoint[];
  composition: ProfitLossCompositionSlice[];
  topOrders: ProfitLossNamedBar[];
  topCustomers: ProfitLossNamedBar[];
  topSuppliers: ProfitLossNamedBar[];
  losingOrders: ProfitLossLosingOrder[];
  options: {
    customers: Array<{ id: string; label: string }>;
    suppliers: string[];
    cities: string[];
    statuses: Array<{ value: string; label: string }>;
  };
};

export type ProfitLossDrillKind =
  | "kpi"
  | "timeline"
  | "order"
  | "customer"
  | "supplier"
  | "city"
  | "fx"
  | "composition"
  | "losing";

export type ProfitLossDrillRequest = {
  kind: ProfitLossDrillKind;
  /** kpi key / series key / orderId / customerId / supplier / city / composition key */
  id: string;
  period?: "day" | "week" | "month";
};
