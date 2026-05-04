/** נתוני לקוחות לבדיקות UI בלבד — ללא DB */
export type MockCustomer = {
  id: number;
  customerCode: string;
  index: string;
  nameHebrew: string;
  nameArabic: string;
  phone: string;
  address: string;
  balance: number;
};

export const mockCustomers: MockCustomer[] = [
  {
    id: 1,
    customerCode: "1001",
    index: "3266",
    nameHebrew: "סאמי עטיה",
    nameArabic: "سامي عطية",
    phone: "052-6773336",
    address: "חיפה",
    balance: -6128.0,
  },
  {
    id: 2,
    customerCode: "1002",
    index: "4102",
    nameHebrew: "יוסי כהן",
    nameArabic: "يوسي كوهين",
    phone: "050-1112233",
    address: "תל אביב",
    balance: 250.5,
  },
  {
    id: 3,
    customerCode: "2005",
    index: "5591",
    nameHebrew: "פאטמה נסר",
    nameArabic: "فاطمة نصر",
    phone: "054-9988776",
    address: "נצרת",
    balance: 0,
  },
];

export function findCustomerByCode(code: string): MockCustomer | undefined {
  return mockCustomers.find((c) => c.customerCode === code.trim());
}
