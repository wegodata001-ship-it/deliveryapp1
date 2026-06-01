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

export type ClientLedgerPayload = {
  rows: ClientLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
