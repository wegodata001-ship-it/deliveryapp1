import "server-only";

export {
  FINANCIAL_SETTINGS_DEFAULTS,
  defaultSerializedFinancial,
  formatDecimalField,
  serializeFinancialRowFromDb,
  serializeFinancialSettings,
  type FinancialSettingsDbRow,
  type SerializedFinancial,
} from "@/lib/financial-settings.shared";

export {
  ensureDefaultFinancialSettings,
  getCurrentFinancialSettings,
  getCurrentFinancialSettingsWithUser,
  loadFinanceSettingsSerialized,
  loadLatestFinancialSettingsRow,
  persistFinanceSettingsRow,
  type PersistFinanceSettingsInput,
} from "@/lib/financial-settings.server";
