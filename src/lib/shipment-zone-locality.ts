import type { ShipmentRecordDto } from "@/app/admin/shipments/types";

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/** האם שתי רשומות שייכות לאותו יישוב לצורך עדכון אזור חלוקה בטבלה */
export function sameShipmentLocality(
  a: Pick<
    ShipmentRecordDto,
    "deliveryLocationId" | "city" | "originalDeliveryLocation" | "address"
  >,
  b: Pick<
    ShipmentRecordDto,
    "deliveryLocationId" | "city" | "originalDeliveryLocation" | "address"
  >,
): boolean {
  if (a.deliveryLocationId && b.deliveryLocationId) {
    return a.deliveryLocationId === b.deliveryLocationId;
  }
  const aCity = norm(a.city) || norm(a.originalDeliveryLocation);
  const bCity = norm(b.city) || norm(b.originalDeliveryLocation);
  if (aCity && bCity && aCity === bCity) return true;
  return false;
}
