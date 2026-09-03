export type ClientCreateInput = {
  customerCode: string;
  nameAr: string;
  nameEn?: string | null;
  phone?: string | null;
  phone2?: string | null;
  country?: string | null;
  email?: string | null;
  notes?: string | null;
};

export type ClientCreateResult = {
  customerId: string;
  id: string;
  customerCode: string;
  customerNameAr: string;
  customerNameEn: string | null;
  name: string;
  phone: string | null;
  phone2: string | null;
  country: string | null;
  email: string | null;
  createdAt: string;
};

export type ClientLedgerRow = {
  id: string;
  name: string;
  customerCode: string | null;
  nameAr: string | null;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  isNew: boolean;
};

export type ClientLedgerListSort = "new_old" | "old_new" | "name_az";

/** ברירת מחדל ברשימת כרטסת לקוחות: ישן → חדש */
export const DEFAULT_CLIENT_LEDGER_LIST_SORT: ClientLedgerListSort = "old_new";

export type ClientLedgerPayload = {
  rows: ClientLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
