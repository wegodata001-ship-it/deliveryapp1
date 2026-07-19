export type ShipmentColumnField =
  | "customerCode"
  | "customerName"
  | "customerPhone"
  | "address"
  | "city"
  | "cartonDetails"
  | "boxes"
  | "weight"
  | "orderAmount"
  | "notes";

export type ShipmentBatchField =
  | "sourceShipmentNumber"
  | "containerNumber"
  | "shippingDate"
  | "arrivalDate"
  | "releaseDate"
  | "warehouseReceiptDate"
  | "distributionStartDate"
  | "totalWeight"
  | "totalBoxes";

export type DictionaryEntry<T extends string> = {
  field: T;
  labelHe: string;
  required?: boolean;
  aliases: readonly string[];
};

/**
 * מילון בלבד: הוספת ספק או שפה אינה משנה את אלגוריתם הזיהוי.
 * aliases נשמרים מפורשים כדי למנוע התאמות רחבות ושגויות בין עמודות דומות.
 */
export const SHIPMENT_COLUMN_DICTIONARY: readonly DictionaryEntry<ShipmentColumnField>[] = [
  {
    field: "customerCode",
    labelHe: "קוד לקוח",
    aliases: ["קוד לקוח", "קוד", "customer code", "client code", "code", "الكود", "رمز العميل", "müşteri kodu"],
  },
  {
    field: "customerName",
    labelHe: "לקוח",
    required: true,
    aliases: ["לקוח", "שם לקוח", "שם הקונה", "customer", "customer name", "client", "client name", "buyer name", "اسم المشتري", "اسم العميل", "العميل", "müşteri", "müşteri adı"],
  },
  {
    field: "customerPhone",
    labelHe: "טלפון",
    aliases: ["טלפון", "נייד", "מספר טלפון", "phone", "phone number", "mobile", "mobile number", "رقم الهاتف", "هاتف", "جوال", "telefon", "telefon numarası"],
  },
  {
    field: "address",
    labelHe: "כתובת",
    aliases: ["כתובת", "רחוב", "address", "street", "delivery address", "العنوان", "عنوان", "adres", "teslimat adresi"],
  },
  {
    field: "city",
    labelHe: "עיר",
    aliases: ["עיר", "יישוב", "ישוב", "city", "town", "locality", "المدينة", "مدينة", "şehir", "ilçe"],
  },
  {
    field: "cartonDetails",
    labelHe: "פרטי קרטונים",
    aliases: ["פרטי קרטונים", "מספרי קרטונים", "carton details", "carton numbers", "box details", "تفاصيل الكراتين", "أرقام الكراتين", "koli detayları"],
  },
  {
    field: "boxes",
    labelHe: "מספר קרטונים",
    aliases: ["מספר קרטונים", "קרטונים", "כמות קרטונים", "cartons", "carton count", "boxes", "box count", "عدد الكراتين", "عدد القطع", "كمية الكراتين", "koli sayısı"],
  },
  {
    field: "weight",
    labelHe: "משקל",
    aliases: ["משקל", "משקל נטו", "weight", "net weight", "kg", "الوزن", "وزن", "ağırlık", "kilo"],
  },
  {
    field: "orderAmount",
    labelHe: "סכום הזמנה",
    aliases: ["סכום הזמנה", "סכום", "סכום כולל", "order amount", "order total", "amount", "total", "المجموع", "إجمالي الطلب", "toplam", "sipariş toplamı"],
  },
  {
    field: "notes",
    labelHe: "הערות",
    aliases: ["הערות", "הערה", "notes", "note", "remarks", "comment", "ملاحظة", "ملاحظات", "not", "açıklama", "备注"],
  },
] as const;

export const SHIPMENT_BATCH_DICTIONARY: readonly DictionaryEntry<ShipmentBatchField>[] = [
  {
    field: "sourceShipmentNumber",
    labelHe: "מספר משלוח מקור",
    aliases: ["מספר משלוח", "מספר אצווה", "shipment number", "shipment no", "batch number", "رقم الشحنة", "sevkiyat numarası"],
  },
  {
    field: "containerNumber",
    labelHe: "מספר קונטיינר",
    aliases: ["מספר קונטיינר", "קונטיינר", "container number", "container no", "container", "رقم الحاوية", "حاوية", "konteyner numarası"],
  },
  {
    field: "shippingDate",
    labelHe: "תאריך שליחה",
    aliases: ["תאריך שליחה", "תאריך משלוח", "shipping date", "dispatch date", "send date", "تاريخ الارسال", "تاريخ الإرسال", "sevk tarihi"],
  },
  {
    field: "arrivalDate",
    labelHe: "תאריך הגעה",
    aliases: ["תאריך הגעה", "arrival date", "date of arrival", "تاريخ الوصول", "varış tarihi"],
  },
  {
    field: "releaseDate",
    labelHe: "תאריך שחרור",
    aliases: ["תאריך שחרור", "release date", "clearance date", "تاريخ الافراج", "تاريخ الإفراج", "çıkış tarihi"],
  },
  {
    field: "warehouseReceiptDate",
    labelHe: "תאריך קבלה במחסן",
    aliases: ["תאריך קבלה במחסן", "warehouse receipt date", "warehouse date", "تاريخ الاستلام بالمستودع", "depo teslim tarihi"],
  },
  {
    field: "distributionStartDate",
    labelHe: "תאריך יציאה לחלוקה",
    aliases: ["תאריך יציאה לחלוקה", "distribution date", "delivery departure date", "تاريخ الخروج للتوزيع", "dağıtım tarihi"],
  },
  {
    field: "totalWeight",
    labelHe: "משקל כולל",
    aliases: ["משקל כולל", "total weight", "gross weight", "مجموع الوزن", "الوزن الكلي", "toplam ağırlık"],
  },
  {
    field: "totalBoxes",
    labelHe: "מספר קרטונים כולל",
    aliases: ["מספר קרטונים כולל", "סהכ קרטונים", "total cartons", "total boxes", "عدد الكراتين", "إجمالي الكراتين", "toplam koli"],
  },
] as const;

export const SHIPMENT_FIELD_LABELS = Object.fromEntries(
  SHIPMENT_COLUMN_DICTIONARY.map((entry) => [entry.field, entry.labelHe]),
) as Record<ShipmentColumnField, string>;
