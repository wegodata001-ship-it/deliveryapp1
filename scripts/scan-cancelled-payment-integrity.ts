import { scanLivePaymentCancellationIntegrity } from "../src/lib/payment-cancellation-integrity-scan";

async function main() {
  const result = await scanLivePaymentCancellationIntegrity();
  console.log(
    JSON.stringify(
      {
        paymentCount: result.paymentCount,
        feeCount: result.feeCount,
        anomalyCount: result.anomalies.length,
        anomalies: result.anomalies,
      },
      null,
      2,
    ),
  );
  if (result.anomalies.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
