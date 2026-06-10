export type SourceTableId =
  | "customers"
  | "orders"
  | "payments"
  | "receivables"
  | "payment-checks"
  | "customer-ledger"
  | "customer-balances"
  | "users"
  | "employees"
  | "payment-methods"
  | "statuses"
  | "payment-locations"
  | "exchange-rates";

export type SourceTableCardDefinition = {
  id: SourceTableId;
  title: string;
  titleHe: string;
  description: string;
  icon: SourceTableIconKey;
  group: "running" | "system" | "finance";
  countLabel?: string | null;
};

export type SourceTableIconKey =
  | "users"
  | "package"
  | "scale"
  | "dollar"
  | "receipt"
  | "credit-card"
  | "id-card"
  | "tag"
  | "map-pin"
  | "landmark";

/** מטא-נתונים סטטיים לכרטיסי טבלאות מקור — ללא DB */
export const SOURCE_TABLE_DEFINITIONS: SourceTableCardDefinition[] = [
  { id: "customers", title: "Customers", titleHe: "לקוחות", description: "טבלת לקוחות, קודים ופרטי קשר.", icon: "users", group: "running" },
  { id: "orders", title: "Orders", titleHe: "הזמנות", description: "כל ההזמנות, שבועות, סכומים וסטטוסים.", icon: "package", group: "running" },
  { id: "customer-balances", title: "CustomerBalances", titleHe: "יתרות", description: "יתרות לקוחות וסטטוס גבייה.", icon: "scale", group: "running" },
  { id: "payments", title: "Payments", titleHe: "תשלומים", description: "תשלומים שנקלטו וקישור להזמנות.", icon: "dollar", group: "finance" },
  { id: "receivables", title: "Receivables", titleHe: "תקבולים", description: "בקרת תקבולים וצפי מול התקבל.", icon: "receipt", group: "finance" },
  {
    id: "payment-checks",
    title: "PaymentChecks",
    titleHe: "טבלת צ׳יקים",
    description: "ניהול צ׳יקים, תאריכי פרעון וסטטוס הפקדה.",
    icon: "credit-card",
    group: "finance",
    countLabel: "סה״כ צ׳יקים",
  },
  { id: "employees", title: "Employees", titleHe: "עובדים", description: "עובדי מערכת פעילים.", icon: "id-card", group: "system" },
  { id: "payment-methods", title: "PaymentMethods", titleHe: "אמצעי תשלום", description: "ערכי אמצעי תשלום במערכת.", icon: "dollar", group: "system" },
  { id: "statuses", title: "Statuses", titleHe: "סטטוסים", description: "סטטוסי הזמנות וגבייה.", icon: "tag", group: "system" },
  { id: "payment-locations", title: "PaymentLocations", titleHe: "מקומות תשלום", description: "מקומות/נקודות לקליטת תשלום.", icon: "map-pin", group: "system" },
  { id: "exchange-rates", title: "ExchangeRates", titleHe: "שערי מטבע", description: "הגדרות שער דולר ושער סופי.", icon: "landmark", group: "system" },
];

export function getSourceTableDefinition(id: string): SourceTableCardDefinition | undefined {
  return SOURCE_TABLE_DEFINITIONS.find((d) => d.id === id);
}
