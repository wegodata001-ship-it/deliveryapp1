import type {
  ShipmentPaymentStatus,
  ShipmentStatus,
  ShipmentPaymentLineDto,
  CashControlMethodValue,
} from "@/app/admin/shipments/types";
import type { WorkCountryCode } from "@/lib/work-country";

export type ShipmentCashExpenseCategory =
  | "FUEL"
  | "ROAD6"
  | "PARKING"
  | "CUSTOMER_REFUND"
  | "OTHER";

export const SHIPMENT_CASH_EXPENSE_LABELS: Record<ShipmentCashExpenseCategory, string> = {
  FUEL: "דלק",
  ROAD6: "כביש 6",
  PARKING: "חניה",
  CUSTOMER_REFUND: "החזר ללקוח",
  OTHER: "אחר",
};

export type ShipmentCashDayDto = {
  id: string;
  dayDate: string; // YYYY-MM-DD
  status: "OPEN" | "CLOSED";
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
};

export type ShipmentCashExpenseDto = {
  id: string;
  dayId: string;
  category: ShipmentCashExpenseCategory;
  categoryLabel: string;
  paymentMethod: string;
  paymentMethodLabel: string;
  amountIls: number;
  notes: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type ShipmentCashControlFilter = {
  workCountry: WorkCountryCode;
  dayDate?: string;
  weekCode?: string;
  month?: string;
  courierId?: string;
  zoneId?: string;
  status?: ShipmentStatus | "";
  paymentStatus?: ShipmentPaymentStatus | "";
  openBalancesOnly?: boolean;
  search?: string;
};

/** סטטוס הפרש בין נקלט לנספר */
export type CashVarianceStatus = "ok" | "small" | "large" | "pending";

export type ShipmentCashMethodLine = {
  method: string;
  label: string;
  /** נקלט אוטומטית מרשימת המשלוחים (לא ניתן לעריכה) */
  collectedIls: number;
  /** נספר בפועל ע״י המנהל — null אם עדיין לא הוזן */
  countedIls: number | null;
  /** הוצאות המשויכות לאמצעי תשלום זה */
  expensesIls: number;
  /** נקלט − הוצאות */
  balanceIls: number;
  /** נספר − נקלט */
  differenceIls: number;
  status: CashVarianceStatus;
  /** true = ערך שהמנהל מזין ידנית (כמו זיכוי) */
  isManual: boolean;
};

export type ShipmentCashDaySummary = {
  collectedIls: number;
  countedIls: number;
  expensesIls: number;
  /** נקלט − הוצאות */
  balanceAfterExpensesIls: number;
  /** נספר − נקלט */
  cashDifferenceIls: number;
};

// ─── Weekly/Monthly View ──────────────────────────────────────────────────────

export type CashControlViewMode = "day" | "week" | "month";

export type CashControlDayRow = {
  dayDate: string;
  dayLabel: string; // ראשון, שני, ...
  dayStatus: "OPEN" | "CLOSED" | null; // null = no session yet
  byMethod: Record<string, number>; // method → collectedIls
  expensesByMethod: Record<string, number>; // method → expenses
  totalCollected: number;
  totalExpenses: number;
  totalBalance: number;
  countedByMethod: Record<string, number | null>;
  differenceByMethod: Record<string, number>;
};

export type CashControlWeekPayload = {
  weekCode: string;
  weekLabel: string;
  days: CashControlDayRow[];
  totalByMethod: Record<string, number>;
  totalExpensesByMethod: Record<string, number>;
  totalCollected: number;
  totalExpenses: number;
  totalBalance: number;
};

// ─── Drill-down ───────────────────────────────────────────────────────────────

export type CashDrilldownPaymentRow = {
  id: string;
  shipmentLabel: string;
  customerName: string | null;
  amountIls: number;
  time: string;
  method: string;
  methodLabel: string;
};

export type CashDrilldownExpenseRow = {
  id: string;
  category: string;
  categoryLabel: string;
  amountIls: number;
  notes: string | null;
  createdAt: string;
};

export type CashDrilldownPayload = {
  type: "receipts" | "expenses";
  dayDate: string;
  method: string;
  methodLabel: string;
  rows: CashDrilldownPaymentRow[] | CashDrilldownExpenseRow[];
  totalIls: number;
};

export type ShipmentCashControlPayload = {
  day: ShipmentCashDayDto | null;
  activeOpenDay: ShipmentCashDayDto | null;
  dayDate: string;
  methods: ShipmentCashMethodLine[];
  expenses: ShipmentCashExpenseDto[];
  summary: ShipmentCashDaySummary;
};

/** @deprecated — נשמר לפעולות קליטה/היסטוריה ישנות */
export type ShipmentCashControlRow = {
  id: string;
  batchId: string;
  batchNumber: string;
  shipmentLabel: string;
  weekCode: string | null;
  shippingDate: string | null;
  arrivalDate: string | null;
  customerName: string | null;
  courierId: string | null;
  courierName: string | null;
  zoneId: string | null;
  zoneName: string | null;
  country: string | null;
  boxes: number | null;
  deliveryFeeIls: number;
  paidAmountIls: number;
  remainingFeeIls: number;
  paymentStatus: ShipmentPaymentStatus;
  status: ShipmentStatus;
  notes: string | null;
  payments: ShipmentPaymentLineDto[];
};

/** @deprecated */
export type ShipmentCashControlKpis = {
  totalFeeIls: number;
  collectedIls: number;
  remainingIls: number;
  shipmentCount: number;
  packagesCount: number;
  collectionRate: number;
  expensesIls: number;
};

/** @deprecated */
export type ShipmentCashGroupSummary = {
  key: string;
  label: string;
  shipmentCount: number;
  packagesCount: number;
  totalFeeIls: number;
  collectedIls: number;
  remainingIls: number;
};

export type ShipmentCashHistoryEntry = {
  id: string;
  at: string;
  actionType: string;
  actionLabel: string;
  userName: string | null;
  amountIls: number | null;
  notes: string | null;
  detail: string | null;
};
