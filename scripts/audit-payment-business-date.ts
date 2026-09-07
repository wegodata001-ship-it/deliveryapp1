/**
 * READ-ONLY — payments stored on Saturday(intake week)
 * that should be Saturday(previous / financial week).
 * Does not UPDATE/DELETE anything.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { paymentDayKeyJerusalem } from "../src/lib/cash-control-daily";
import { resolvePaymentIntakeAccountingPeriod } from "../src/lib/payment-intake-accounting-period";
import { getBusinessWeekClosingDate } from "../src/lib/work-week";
import { activePaidPaymentWhere } from "../src/lib/payment-record-status-shared";

async function main() {
  const rows = await prisma.payment.findMany({
    where: {
      AND: [activePaidPaymentWhere, { weekCode: { not: null } }],
    },
    select: {
      id: true,
      paymentCode: true,
      weekCode: true,
      intakeDate: true,
      paymentDate: true,
      createdAt: true,
      amountUsd: true,
      amountIls: true,
      currency: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const incorrectlyPeriodized = [];

  for (const p of rows) {
    const intakeWeek = p.weekCode?.trim() || "";
    const period = resolvePaymentIntakeAccountingPeriod(intakeWeek);
    if (!period) continue;
    const storedDate = paymentDayKeyJerusalem(p);
    const intakeWeekSaturday = getBusinessWeekClosingDate(intakeWeek);
    if (storedDate !== intakeWeekSaturday) continue;
    if (storedDate === period.businessDate) continue;
    incorrectlyPeriodized.push({
      id: p.id,
      paymentCode: p.paymentCode,
      intakeWeek,
      currentlyStoredDate: storedDate,
      expectedFinancialWeek: period.financialWeek,
      expectedDate: period.businessDate,
      amountUsd: p.amountUsd?.toString() ?? null,
      amountIls: p.amountIls?.toString() ?? null,
      currency: p.currency,
      method: p.usdPaymentMethod || p.ilsPaymentMethod || p.paymentMethod,
    });
  }

  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        incorrectlyPeriodizedCount: incorrectlyPeriodized.length,
        examples: incorrectlyPeriodized.slice(0, 25),
        paymentIds: incorrectlyPeriodized.map((r) => r.id),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
