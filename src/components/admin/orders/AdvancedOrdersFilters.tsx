"use client";

import { IntakeLocationCombobox } from "@/components/admin/IntakeLocationCombobox";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import { OS } from "@/lib/order-status-slugs";
import type { UseOrdersListFiltersReturn } from "./useOrdersListFilters";

type Props = Pick<
  UseOrdersListFiltersReturn,
  | "dateFrom"
  | "setDateFrom"
  | "dateTo"
  | "setDateTo"
  | "minAmount"
  | "setMinAmount"
  | "maxAmount"
  | "setMaxAmount"
  | "orderNumDraft"
  | "setOrderNumDraft"
  | "phoneDraft"
  | "setPhoneDraft"
  | "payLoc"
  | "setPayLoc"
  | "createdByValues"
  | "setCreatedByValues"
  | "openOnly"
  | "setOpenOnly"
  | "completedOnly"
  | "setCompletedOnly"
  | "setStatusValues"
  | "applyAdvancedFilters"
  | "clearAllFilters"
  | "hasClearableFilters"
  | "createdByFilterOptions"
  | "paymentLocationOptions"
  | "msStrings"
  | "msDir"
  | "countryValues"
  | "setCountryValues"
  | "countryOptions"
>;

export function AdvancedOrdersFilters(props: Props) {
  const {
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    orderNumDraft,
    setOrderNumDraft,
    phoneDraft,
    setPhoneDraft,
    payLoc,
    setPayLoc,
    createdByValues,
    setCreatedByValues,
    openOnly,
    setOpenOnly,
    completedOnly,
    setCompletedOnly,
    setStatusValues,
    applyAdvancedFilters,
    clearAllFilters,
    hasClearableFilters,
    createdByFilterOptions,
    paymentLocationOptions,
    msStrings,
    msDir,
    countryValues,
    setCountryValues,
    countryOptions,
  } = props;

  return (
    <div className="ofb-adv" dir="rtl">
      <div className="ofb-adv__grid">
        <label className="ofb-adv__field">
          <span className="ofb-adv__label">מתאריך</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">עד תאריך</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">מספר הזמנה</span>
          <input
            type="text"
            value={orderNumDraft}
            dir="ltr"
            onChange={(e) => setOrderNumDraft(e.target.value)}
            className="ofb-adv__input"
            autoComplete="off"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">טלפון</span>
          <input
            type="tel"
            value={phoneDraft}
            dir="ltr"
            onChange={(e) => setPhoneDraft(e.target.value)}
            className="ofb-adv__input"
            autoComplete="off"
          />
        </label>

        <div className="ofb-adv__field">
          <ShipmentMultiSelectFilter
            label="מדינה"
            options={countryOptions}
            values={countryValues}
            onChange={setCountryValues}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <div className="ofb-adv__field">
          <ShipmentMultiSelectFilter
            label="עובד שפתח הזמנה"
            options={createdByFilterOptions}
            values={createdByValues}
            onChange={setCreatedByValues}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">סכום מינימום ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={minAmount}
            dir="ltr"
            onChange={(e) => setMinAmount(e.target.value)}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">סכום מקסימום ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={maxAmount}
            dir="ltr"
            onChange={(e) => setMaxAmount(e.target.value)}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">מקום תשלום</span>
          <IntakeLocationCombobox
            variant="filter"
            inputClassName="ofb-adv__input"
            value={payLoc}
            label={
              payLoc === "NONE"
                ? "ללא"
                : payLoc
                  ? (paymentLocationOptions.find((p) => p.id === payLoc)?.label ?? "")
                  : ""
            }
            allowEmpty
            emptyLabel="הכל"
            extraEmptyOptions={[{ value: "NONE", label: "ללא" }]}
            onChange={setPayLoc}
          />
        </label>
      </div>

      <div className="ofb-adv__checks">
        <label className="ofb-adv__check">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => {
              const checked = e.target.checked;
              setOpenOnly(checked);
              if (checked) {
                setCompletedOnly(false);
                setStatusValues([OS.OPEN]);
              }
            }}
          />
          הזמנות פתוחות בלבד
        </label>
        <label className="ofb-adv__check">
          <input
            type="checkbox"
            checked={completedOnly}
            onChange={(e) => {
              const checked = e.target.checked;
              setCompletedOnly(checked);
              if (checked) {
                setOpenOnly(false);
                setStatusValues([OS.COMPLETED]);
              }
            }}
          />
          הזמנות שבוצעו בלבד
        </label>
      </div>

      <div className="ofb-adv__foot">
        <button
          type="button"
          className="ofb__btn ofb__btn--ghost"
          onClick={clearAllFilters}
          disabled={!hasClearableFilters}
        >
          נקה
        </button>
        <button type="button" className="ofb__btn ofb__btn--primary" onClick={applyAdvancedFilters}>
          החל
        </button>
      </div>
    </div>
  );
}
