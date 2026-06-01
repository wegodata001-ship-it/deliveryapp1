"use client";

import {
  ErpCreatableCombobox,
  type ErpComboboxOption,
  type ErpCreatableComboboxProps,
} from "@/components/admin/ErpCreatableCombobox";
import { createIntakeLocationApi, fetchIntakeLocationsApi } from "@/lib/intake-locations-api";

export type IntakeLocationComboboxProps = Omit<
  ErpCreatableComboboxProps,
  "entityName" | "fetchOptions" | "createOption" | "addNewMenuLabel" | "dialogTitle"
> & {
  onOptionCreated?: (option: ErpComboboxOption) => void;
};

export function IntakeLocationCombobox(props: IntakeLocationComboboxProps) {
  return (
    <ErpCreatableCombobox
      {...props}
      entityName="מקום תשלום"
      addNewMenuLabel="+ הוסף מקום"
      dialogTitle="הוסף מקום תשלום"
      placeholder={props.placeholder ?? "בחר מקום"}
      fetchOptions={fetchIntakeLocationsApi}
      createOption={createIntakeLocationApi}
      minSearchLength={1}
      minCreateLength={2}
    />
  );
}
