UPDATE "Order"
SET "countryCode" = CASE "sourceCountry"::text
  WHEN 'CHINA' THEN 'CN'::"WorkCountryCode"
  WHEN 'UAE' THEN 'AE'::"WorkCountryCode"
  WHEN 'JORDAN' THEN 'JO'::"WorkCountryCode"
  ELSE 'TR'::"WorkCountryCode"
END;

UPDATE "Payment" p
SET "countryCode" = o."countryCode"
FROM "Order" o
WHERE p."orderId" = o."id";

UPDATE "PaymentCheck" pc
SET "countryCode" = p."countryCode"
FROM "Payment" p
WHERE pc."paymentId" = p."id";

UPDATE "Customer" SET "countryCode" = 'TR' WHERE "countryCode" IS NULL;
UPDATE "ReceiptControl" SET "countryCode" = 'TR' WHERE "countryCode" IS NULL;
