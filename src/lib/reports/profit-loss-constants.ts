export const PROFIT_LOSS_CHART_COUNTRIES = [
  { key: "TURKEY", label: "טורקיה", flag: "🇹🇷" },
  { key: "CHINA", label: "סין", flag: "🇨🇳" },
  { key: "UAE", label: "איחוד האמירויות", flag: "🇦🇪" },
] as const;

export type ProfitLossChartCountryLabel =
  (typeof PROFIT_LOSS_CHART_COUNTRIES)[number]["label"];
