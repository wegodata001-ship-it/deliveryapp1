import "server-only";

import { Prisma } from "@prisma/client";

/** SQL fragment for raw aggregations (customers list balance, etc.) */
export const ACTIVE_PAID_PAYMENT_SQL = Prisma.sql`"isPaid" = TRUE AND ("status" IS NULL OR "status" <> 'CANCELLED')`;
