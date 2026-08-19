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
  | "setWeek"
  | "pushFilters"
  | "schedulePush"
  | "clearAllFilters"
  | "hasClearableFilters"
  | "setAdvancedOpen"
  | "getAhWeekCodeFromDateRange"
  | "createdByFilterOptions"
  | "paymentLocationOptions"
  | "msStrings"
  | "msDir"
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
    setWeek,
    pushFilters,
    schedulePush,
    clearAllFilters,
    hasClearableFilters,
    setAdvancedOpen,
    getAhWeekCodeFromDateRange,
    createdByFilterOptions,
    paymentLocationOptions,
    msStrings,
    msDir,
  } = props;

  return (
    <div className="ofb-adv" dir="rtl">
      <div className="ofb-adv__grid">
        <label className="ofb-adv__field">
          <span className="ofb-adv__label">מתאריך</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setDateFrom(nextFrom);
              const wk = getAhWeekCodeFromDateRange(nextFrom, dateTo);
              const nextWeek = wk ?? "";
              setWeek(nextWeek);
              pushFilters({ dateFrom: nextFrom, week: nextWeek });
            }}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">עד תאריך</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              const nextTo = e.target.value;
              setDateTo(nextTo);
              const wk = getAhWeekCodeFromDateRange(dateFrom, nextTo);
              const nextWeek = wk ?? "";
              setWeek(nextWeek);
              pushFilters({ dateTo: nextTo, week: nextWeek });
            }}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">סכום מינימום ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={minAmount}
            dir="ltr"
            onChange={(e) => {
              const v = e.target.value;
              setMinAmount(v);
              schedulePush({ minAmountUsd: v });
            }}
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
            onChange={(e) => {
              const v = e.target.value;
              setMaxAmount(v);
              schedulePush({ maxAmountUsd: v });
            }}
            className="ofb-adv__input"
          />
        </label>

        <label className="ofb-adv__field">
          <span className="ofb-adv__label">מספר הזמנה</span>
          <input
            type="text"
            value={orderNumDraft}
            dir="ltr"
            onChange={(e) => {
              const v = e.target.value;
              setOrderNumDraft(v);
              schedulePush({ orderNumber: v });
            }}
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
            onChange={(e) => {
              const v = e.target.value;
              setPhoneDraft(v);
              schedulePush({ phone: v });
            }}
            className="ofb-adv__input"
            autoComplete="off"
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
            onChange={(id) => {
              setPayLoc(id);
              pushFilters({ paymentLocation: id });
            }}
          />
        </label>

        <div className="ofb-adv__field">
          <ShipmentMultiSelectFilter
            label="עובד שפתח הזמנה"
            options={createdByFilterOptions}
            values={createdByValues}
            onChange={(next) => {
              setCreatedByValues(next);
              pushFilters({ createdBy: next });
            }}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <label className="ofb-adv__field ofb-adv__field--check">
          <span className="ofb-adv__check">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => {
                const checked = e.target.checked;
                setOpenOnly(checked);
                if (checked) {
                  setCompletedOnly(false);
                  setStatusValues([OS.OPEN]);
                  pushFilters({ openOnly: true, completedOnly: false, status: [OS.OPEN] });
                } else {
                  pushFilters({ openOnly: false });
                }
              }}
            />
            הזמנות פתוחות בלבד
          </span>
        </label>

        <label className="ofb-adv__field ofb-adv__field--check">
          <span className="ofb-adv__check">
            <input
              type="checkbox"
              checked={completedOnly}
              onChange={(e) => {
                const checked = e.target.checked;
                setCompletedOnly(checked);
                if (checked) {
                  setOpenOnly(false);
                  setStatusValues([OS.COMPLETED]);
                  pushFilters({ completedOnly: true, openOnly: false, status: [OS.COMPLETED] });
                } else {
                  pushFilters({ completedOnly: false });
                }
              }}
            />
            הזמנות שבוצעו בלבד
          </span>
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
        <button type="button" className="ofb__btn ofb__btn--primary" onClick={() => setAdvancedOpen(false)}>
          החל
        </button>
        <button type="button" className="ofb__btn ofb__btn--ghost" onClick={() => setAdvancedOpen(false)}>
          סגור
        </button>
      </div>
    </div>
  );
}
