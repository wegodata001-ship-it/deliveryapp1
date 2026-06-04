/**
 * מוסיף ל-Payment בלבד: status, cancelledAt, cancelledById, cancelReason
 * בלי prisma db push (שעלול למחוק עמודות ישנות ב-SourceStatus).
 *
 * הרצה: npx tsx scripts/ensure-payment-status-columns.ts
 */
import { ensurePaymentRecordStatusColumns } from "../src/lib/payment-record-status";

async function main() {
  await ensurePaymentRecordStatusColumns();
  console.log("[ok] Payment status columns ensured (ACTIVE/CANCELLED + cancel fields)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
