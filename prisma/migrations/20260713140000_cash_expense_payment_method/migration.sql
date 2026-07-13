-- הוצאות קופה: אמצעי תשלום (תאימות לאחור — מזומן)
ALTER TABLE "CashExpense" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH';

CREATE INDEX "CashExpense_paymentMethod_idx" ON "CashExpense"("paymentMethod");
