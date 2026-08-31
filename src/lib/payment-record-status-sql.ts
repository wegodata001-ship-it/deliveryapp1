import "server-only";

import { Prisma } from "@prisma/client";

/** SQL fragment for raw aggregations (customers list balance, etc.) */
export const ACTIVE_PAID_PAYMENT_SQL = Prisma.sql`"isPaid" = TRUE AND ("status" IS NULL OR "status" <> 'CANCELLED')`;

/** אותם exclusions של SSOT — לא לספור עמלה / יתרת זכות כתשלום שסוגר חוב */
export const CUSTOMER_DEBT_PAYMENT_BUSINESS_SQL = Prisma.sql`("businessType" IS NULL OR "businessType" NOT IN ('ADJUSTMENT_FEE', 'CUSTOMER_CREDIT'))`;

export const CUSTOMER_CREDIT_PAYMENT_BUSINESS_SQL = Prisma.sql`"businessType" = 'CUSTOMER_CREDIT'`;
