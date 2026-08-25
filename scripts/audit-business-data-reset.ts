/**
 * READ-ONLY audit: classify every Prisma table DELETE vs KEEP for business-data reset.
 * Does NOT delete anything.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type Row = {
  table: string;
  model: string;
  action: "DELETE" | "KEEP" | "REVIEW";
  count: number;
  reason: string;
};

async function main() {
  const prisma = new PrismaClient();

  // Count helper — never throws away the whole audit if one table fails
  async function c(label: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      console.error(`[count-fail] ${label}:`, e instanceof Error ? e.message : e);
      return -1;
    }
  }

  const rows: Row[] = [];

  const add = (
    table: string,
    model: string,
    action: Row["action"],
    count: number,
    reason: string,
  ) => rows.push({ table, model, action, count, reason });

  // ── KEEP (master / system) ───────────────────────────────────────────────
  add("User", "User", "KEEP", await c("User", () => prisma.user.count()), "משתמשי מערכת");
  add(
    "Permission",
    "Permission",
    "KEEP",
    await c("Permission", () => prisma.permission.count()),
    "הרשאות",
  );
  add(
    "UserPermission",
    "UserPermission",
    "KEEP",
    await c("UserPermission", () => prisma.userPermission.count()),
    "שיוך הרשאות",
  );
  add(
    "FinancialSettings",
    "FinancialSettings",
    "KEEP",
    await c("FinancialSettings", () => prisma.financialSettings.count()),
    "הגדרות פיננסיות",
  );
  add(
    "AdminSystemSettings",
    "AdminSystemSettings",
    "KEEP",
    await c("AdminSystemSettings", () => prisma.adminSystemSettings.count()),
    "הגדרות מערכת",
  );
  add(
    "SourceStatus",
    "SourceStatus",
    "KEEP",
    await c("SourceStatus", () => prisma.sourceStatus.count()),
    "סטטוסים",
  );
  add(
    "SourcePaymentMethod",
    "SourcePaymentMethod",
    "KEEP",
    await c("SourcePaymentMethod", () => prisma.sourcePaymentMethod.count()),
    "סוגי תשלום (מקור)",
  );
  add(
    "PaymentMethodRegistry / payment_methods",
    "PaymentMethodRegistry",
    "KEEP",
    await c("PaymentMethodRegistry", () => prisma.paymentMethodRegistry.count()),
    "רשימת אמצעי תשלום",
  );
  add(
    "PaymentPoint",
    "PaymentPoint",
    "KEEP",
    await c("PaymentPoint", () => prisma.paymentPoint.count()),
    "נקודות תשלום",
  );
  add(
    "IntakeLocation",
    "IntakeLocation",
    "KEEP",
    await c("IntakeLocation", () => prisma.intakeLocation.count()),
    "מיקומי קליטה",
  );
  add(
    "OrderLocation",
    "OrderLocation",
    "KEEP",
    await c("OrderLocation", () => prisma.orderLocation.count()),
    "מיקומי הזמנה",
  );
  add(
    "PaymentLocation",
    "PaymentLocation",
    "KEEP",
    await c("PaymentLocation", () => prisma.paymentLocation.count()),
    "מיקומי תשלום",
  );
  add(
    "ShipmentDeliveryZone",
    "ShipmentDeliveryZone",
    "KEEP",
    await c("ShipmentDeliveryZone", () => prisma.shipmentDeliveryZone.count()),
    "אזורי חלוקה",
  );
  add(
    "DeliveryLocation",
    "DeliveryLocation",
    "KEEP",
    await c("DeliveryLocation", () => prisma.deliveryLocation.count()),
    "יישובים",
  );
  add(
    "DeliveryLocationAlias",
    "DeliveryLocationAlias",
    "KEEP",
    await c("DeliveryLocationAlias", () => prisma.deliveryLocationAlias.count()),
    "כינויי יישובים",
  );
  add(
    "ShipmentCourier",
    "ShipmentCourier",
    "KEEP",
    await c("ShipmentCourier", () => prisma.shipmentCourier.count()),
    "שליחים (master)",
  );
  add(
    "ShipmentExpenseType",
    "ShipmentExpenseType",
    "KEEP",
    await c("ShipmentExpenseType", () => prisma.shipmentExpenseType.count()),
    "סוגי הוצאות משלוח",
  );
  add(
    "ArabicDisplayNameCache",
    "ArabicDisplayNameCache",
    "KEEP",
    await c("ArabicDisplayNameCache", () => prisma.arabicDisplayNameCache.count()),
    "cache שמות ערבית",
  );
  add(
    "InventoryItem",
    "InventoryItem",
    "KEEP",
    await c("InventoryItem", () => prisma.inventoryItem.count()),
    "פריטי מלאי (master) — לא נתוני בדיקת לקוח/הזמנה",
  );

  // ── DELETE — core business ───────────────────────────────────────────────
  add(
    "PaymentCheck",
    "PaymentCheck",
    "DELETE",
    await c("PaymentCheck", () => prisma.paymentCheck.count()),
    "צ'קים לתשלומים",
  );
  add(
    "PaymentMethodAllocation",
    "PaymentMethodAllocation",
    "DELETE",
    await c("PaymentMethodAllocation", () => prisma.paymentMethodAllocation.count()),
    "פיצולי אמצעי תשלום",
  );
  add(
    "PaymentAdjustmentFee",
    "PaymentAdjustmentFee",
    "DELETE",
    await c("PaymentAdjustmentFee", () => prisma.paymentAdjustmentFee.count()),
    "התאמות עמלות תשלום",
  );
  add(
    "PaymentCashAuditReview",
    "PaymentCashAuditReview",
    "DELETE",
    await c("PaymentCashAuditReview", () => prisma.paymentCashAuditReview.count()),
    "ביקורת קופה על תשלומים",
  );
  add(
    "OrderPaymentBreakdown",
    "OrderPaymentBreakdown",
    "DELETE",
    await c("OrderPaymentBreakdown", () => prisma.orderPaymentBreakdown.count()),
    "פירוט תשלום להזמנה",
  );
  add(
    "PaymentPlan",
    "PaymentPlan",
    "DELETE",
    await c("PaymentPlan", () => prisma.paymentPlan.count()),
    "תוכניות תשלום",
  );
  add(
    "Payment",
    "Payment",
    "DELETE",
    await c("Payment", () => prisma.payment.count()),
    "קליטות תשלום",
  );
  add(
    "OrderEditRequest",
    "OrderEditRequest",
    "DELETE",
    await c("OrderEditRequest", () => prisma.orderEditRequest.count()),
    "בקשות עריכת הזמנה",
  );
  add(
    "ApprovalRequest",
    "ApprovalRequest",
    "DELETE",
    await c("ApprovalRequest", () => prisma.approvalRequest.count()),
    "בקשות אישור עסקיות",
  );
  add(
    "Order",
    "Order",
    "DELETE",
    await c("Order", () => prisma.order.count()),
    "הזמנות",
  );
  add(
    "OrderWeekCounter",
    "OrderWeekCounter",
    "DELETE",
    await c("OrderWeekCounter", () => prisma.orderWeekCounter.count()),
    "מוני מספר הזמנה לשבוע — לאיפוס רצף",
  );
  add(
    "ReceiptControl",
    "ReceiptControl",
    "DELETE",
    await c("ReceiptControl", () => prisma.receiptControl.count()),
    "בקרת קבלות",
  );
  add(
    "CustomerBalanceStatusOverride",
    "CustomerBalanceStatusOverride",
    "DELETE",
    await c("CustomerBalanceStatusOverride", () => prisma.customerBalanceStatusOverride.count()),
    "דריסות סטטוס יתרה",
  );
  add(
    "Customer",
    "Customer",
    "DELETE",
    await c("Customer", () => prisma.customer.count()),
    "לקוחות",
  );

  // Cash / flow operational (derived from business activity)
  add(
    "CashExpense",
    "CashExpense",
    "DELETE",
    await c("CashExpense", () => prisma.cashExpense.count()),
    "הוצאות קופה שבועיות",
  );
  add(
    "CashCount",
    "CashCount",
    "DELETE",
    await c("CashCount", () => prisma.cashCount.count()),
    "ספירות מזומן",
  );
  add(
    "CashDailyDrawerCount",
    "CashDailyDrawerCount",
    "DELETE",
    await c("CashDailyDrawerCount", () => prisma.cashDailyDrawerCount.count()),
    "ספירות מגירה יומיות",
  );
  add(
    "CashWeekFlow",
    "CashWeekFlow",
    "DELETE",
    await c("CashWeekFlow", () => prisma.cashWeekFlow.count()),
    "נתוני תזרים שבועיים (ספירות/FX/העברות)",
  );
  add(
    "TurkeyTransferMovement",
    "TurkeyTransferMovement",
    "DELETE",
    await c("TurkeyTransferMovement", () => prisma.turkeyTransferMovement.count()),
    "תנועות העברה לטורקיה",
  );

  // Imports / legacy demo
  add(
    "ExcelImportRow",
    "ExcelImportRow",
    "DELETE",
    await c("ExcelImportRow", () => prisma.excelImportRow.count()),
    "שורות ייבוא Excel",
  );
  add(
    "ExcelImportFile",
    "ExcelImportFile",
    "DELETE",
    await c("ExcelImportFile", () => prisma.excelImportFile.count()),
    "קבצי ייבוא",
  );
  add(
    "ManualImportRow / import_rows",
    "ManualImportRow",
    "DELETE",
    await c("ManualImportRow", () => prisma.manualImportRow.count()),
    "שורות ייבוא ידני",
  );
  add(
    "ManualImport / imports",
    "ManualImport",
    "DELETE",
    await c("ManualImport", () => prisma.manualImport.count()),
    "ייבואים ידניים",
  );
  add(
    "LegacyRawRow",
    "LegacyRawRow",
    "DELETE",
    await c("LegacyRawRow", () => prisma.legacyRawRow.count()),
    "נתוני legacy",
  );
  add(
    "UserNotification",
    "UserNotification",
    "DELETE",
    await c("UserNotification", () => prisma.userNotification.count()),
    "התראות על אירועים עסקיים",
  );

  // Shipments
  add(
    "ShipmentPaymentLine",
    "ShipmentPaymentLine",
    "DELETE",
    await c("ShipmentPaymentLine", () => prisma.shipmentPaymentLine.count()),
    "תשלומי דמי משלוח",
  );
  add(
    "ShipmentRecordExpense",
    "ShipmentRecordExpense",
    "DELETE",
    await c("ShipmentRecordExpense", () => prisma.shipmentRecordExpense.count()),
    "הוצאות פר-חבילה",
  );
  add(
    "ShipmentBatchExpense",
    "ShipmentBatchExpense",
    "DELETE",
    await c("ShipmentBatchExpense", () => prisma.shipmentBatchExpense.count()),
    "הוצאות פר-קונטיינר",
  );
  add(
    "ShipmentRecord",
    "ShipmentRecord",
    "DELETE",
    await c("ShipmentRecord", () => prisma.shipmentRecord.count()),
    "חבילות / לקוחות במשלוח",
  );
  add(
    "ShipmentCashExpense",
    "ShipmentCashExpense",
    "DELETE",
    await c("ShipmentCashExpense", () => prisma.shipmentCashExpense.count()),
    "הוצאות בקרת קופה משלוחים",
  );
  add(
    "ShipmentCashCount",
    "ShipmentCashCount",
    "DELETE",
    await c("ShipmentCashCount", () => prisma.shipmentCashCount.count()),
    "ספירות קופה משלוחים",
  );
  add(
    "ShipmentCashDay",
    "ShipmentCashDay",
    "DELETE",
    await c("ShipmentCashDay", () => prisma.shipmentCashDay.count()),
    "ימי עבודה קופה משלוחים",
  );
  add(
    "ShipmentBatch",
    "ShipmentBatch",
    "DELETE",
    await c("ShipmentBatch", () => prisma.shipmentBatch.count()),
    "משלוחים / קונטיינרים (אצוות)",
  );
  add(
    "ManualShipment",
    "ManualShipment",
    "DELETE",
    await c("ManualShipment", () => prisma.manualShipment.count()),
    "משלוחים בהזנה ידנית",
  );
  add(
    "DeliveryLocationAudit",
    "DeliveryLocationAudit",
    "DELETE",
    await c("DeliveryLocationAudit", () => prisma.deliveryLocationAudit.count()),
    "היסטוריית תיקוני יישוב על רשומות משלוח",
  );

  // Documents & inventory counts (operational)
  add(
    "Document",
    "Document",
    "REVIEW",
    await c("Document", () => prisma.document.count()),
    "מסמכים מצורפים — למחוק אם entityType עסקי (ORDER/PAYMENT/CUSTOMER/SHIPMENT)",
  );
  add(
    "InventoryCountLine",
    "InventoryCountLine",
    "REVIEW",
    await c("InventoryCountLine", () => prisma.inventoryCountLine.count()),
    "שורות ספירת מלאי — לא לקוחות/הזמנות; לאשר אם למחוק ספירות בדיקה",
  );
  add(
    "InventoryCount",
    "InventoryCount",
    "REVIEW",
    await c("InventoryCount", () => prisma.inventoryCount.count()),
    "ספירות מלאי — לאשר אם נתוני בדיקה",
  );

  add(
    "AuditLog",
    "AuditLog",
    "REVIEW",
    await c("AuditLog", () => prisma.auditLog.count()),
    "יומן ביקורת — מומלץ למחוק רשומות עסקיות; לשמור לוגים מערכתיים אם קיימים",
  );

  await prisma.$disconnect();

  const del = rows.filter((r) => r.action === "DELETE");
  const keep = rows.filter((r) => r.action === "KEEP");
  const review = rows.filter((r) => r.action === "REVIEW");
  const sum = (xs: Row[]) => xs.reduce((s, r) => s + Math.max(0, r.count), 0);

  console.log("\n=== BUSINESS DATA RESET AUDIT (READ-ONLY) ===\n");
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        totals: {
          deleteTables: del.length,
          deleteRows: sum(del),
          keepTables: keep.length,
          keepRows: sum(keep),
          reviewTables: review.length,
          reviewRows: sum(review),
        },
        DELETE: del,
        KEEP: keep,
        REVIEW: review,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
