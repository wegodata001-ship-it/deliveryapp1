import { searchCustomersPrisma } from "@/lib/customer-search-prisma";
import { withPerfTimer } from "@/lib/perf-log";

export type CustomerApiSearchRow = {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  phone2: string | null;
  country: string | null;
  city: string | null;
  customerType: string | null;
};

export type CustomerApiSearchParams = {
  query: string;
  limit?: number;
  page?: number;
};

export async function searchCustomersByQuery(raw: string): Promise<CustomerApiSearchRow[]> {
  return searchCustomersByQueryPaged({ query: raw });
}

export async function searchCustomersByQueryPaged(params: CustomerApiSearchParams): Promise<CustomerApiSearchRow[]> {
  return withPerfTimer("search.customers.api", async () => {
    const limit = Math.min(50, Math.max(5, Math.floor(params.limit ?? 20)));
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const skip = (page - 1) * limit;

    const rows = await searchCustomersPrisma(params.query, { limit: limit + skip });
    const pageRows = rows.slice(skip, skip + limit);

    return pageRows.map((r) => ({
      id: r.id,
      customerCode: r.code,
      oldCustomerCode: r.oldCustomerCode ?? null,
      displayName: r.label,
      nameHe: r.nameHe ?? null,
      nameEn: r.nameEn ?? null,
      nameAr: r.nameAr ?? null,
      phone: r.phone ?? null,
      phone2: r.phone2 ?? null,
      country: null,
      city: r.city ?? null,
      customerType: r.customerType ?? null,
    }));
  });
}
