"use client";

import type { ReactNode } from "react";
import { OrdersFilterBar } from "./OrdersFilterBar";
import {
  useOrdersListFilters,
  type OrdersCountryFilterOption,
  type OrdersCreatedByOption,
  type OrdersPaymentLocationOption,
} from "./useOrdersListFilters";
import "./orders-filters.css";

export type { OrdersCountryFilterOption, OrdersCreatedByOption, OrdersPaymentLocationOption };

export type OrdersFiltersProps = {
  fromYmd: string;
  toYmd: string;
  ahWeekSelect: string;
  activePreset: string | null;
  customerQuery: string;
  ordersOrderNum: string;
  customerPhone: string;
  statusFilter: string[];
  countryFilter: string[];
  createdByIds: string[];
  createdByOptions: OrdersCreatedByOption[];
  countryFilterOptions: OrdersCountryFilterOption[];
  paymentTypes: string[];
  paymentLocation: string;
  paymentLocationOptions: OrdersPaymentLocationOption[];
  amountMin: string;
  amountMax: string;
  ordersOpenOnly: boolean;
  ordersReadyOnly: boolean;
  leadingActions?: ReactNode;
  exportActions?: ReactNode;
};

export function OrdersFilters(props: OrdersFiltersProps) {
  const {
    fromYmd,
    toYmd,
    ahWeekSelect,
    activePreset: _activePreset,
    customerQuery,
    ordersOrderNum,
    customerPhone,
    statusFilter,
    countryFilter,
    createdByIds,
    createdByOptions,
    countryFilterOptions,
    paymentTypes,
    paymentLocation,
    paymentLocationOptions,
    amountMin,
    amountMax,
    ordersOpenOnly,
    ordersReadyOnly,
    leadingActions,
    exportActions,
  } = props;

  const f = useOrdersListFilters({
    fromYmd,
    toYmd,
    ahWeekSelect,
    customerQuery,
    ordersOrderNum,
    customerPhone,
    statusFilter,
    countryFilter,
    createdByIds,
    createdByOptions,
    countryFilterOptions,
    paymentTypes,
    paymentLocation,
    paymentLocationOptions,
    amountMin,
    amountMax,
    ordersOpenOnly,
    ordersReadyOnly,
  });

  return <OrdersFilterBar {...f} leadingActions={leadingActions} exportActions={exportActions} />;
}
