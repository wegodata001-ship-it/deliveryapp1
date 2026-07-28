/**
 * מנקה ייבוא שגוי: יישובים שנשמרו כ־"1 דרום" / "דרום 1" / "אזור חלוקה"
 * + כינויים מקושרים. לא מוחק יישובים אמיתיים (רהט, אבו סנאן…).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const WORD = "צפון|דרום|מרכז|משולש|שרון|גולן|ירושלים|חיפה|נגב|עמק|גליל";

function isZoneLike(name: string) {
  const t = name.replace(/\s+/g, " ").trim();
  if (new RegExp(`^(${WORD})\\s*\\d+$`, "i").test(t)) return true;
  if (new RegExp(`^\\d+\\s*(${WORD})$`, "i").test(t)) return true;
  return false;
}

const JUNK = new Set([
  "אזור חלוקה",
  "מקום מסירה",
  "מקום מסירה מעודכן",
  "מקומות מסירה",
  "דרך",
  "במשרד",
  "יתרת פתיחה",
]);

async function main() {
  const locations = await prisma.deliveryLocation.findMany({
    select: { id: true, displayName: true },
  });
  const bad = locations.filter(
    (l) => isZoneLike(l.displayName) || JUNK.has(l.displayName.trim()),
  );
  console.log(
    "bad locations",
    bad.map((b) => b.displayName),
  );
  const ids = bad.map((b) => b.id);
  if (!ids.length) {
    console.log("nothing to clean");
    return;
  }

  const aliases = await prisma.deliveryLocationAlias.deleteMany({
    where: { deliveryLocationId: { in: ids } },
  });
  await prisma.shipmentRecord.updateMany({
    where: { deliveryLocationId: { in: ids } },
    data: { deliveryLocationId: null, locationMatchStatus: "UNMATCHED" },
  });
  await prisma.deliveryLocationAudit.deleteMany({
    where: { deliveryLocationId: { in: ids } },
  });
  const locs = await prisma.deliveryLocation.deleteMany({ where: { id: { in: ids } } });
  console.log({ deletedAliases: aliases.count, deletedLocations: locs.count });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
