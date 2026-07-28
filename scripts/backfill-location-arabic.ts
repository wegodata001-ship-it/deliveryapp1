import { backfillDeliveryLocationArabicNames } from "../src/lib/shipment-courier-pdf-data";

backfillDeliveryLocationArabicNames()
  .then((n) => {
    console.log("backfilled locations:", n);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
