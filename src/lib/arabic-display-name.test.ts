import assert from "node:assert/strict";
import { getArabicDisplayName } from "./arabic-display-name";
import { suggestArabicCustomerName } from "./arabic-name-suggest";
import { transliterateHebrewToArabic } from "./hebrew-name-transliterate";

const emptyCache = new Map();

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "محمد سليمان",
    cache: emptyCache,
  }).arabicName,
  "محمد سليمان",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "מוחמד עלי",
    cache: emptyCache,
  }).arabicName,
  "محمد علي",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "Ahmad Khatib",
    cache: emptyCache,
  }).arabicName,
  "أحمد خطيب",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "David Cohen",
    cache: emptyCache,
  }).arabicName,
  "دافيد كوهين",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "אחמד אבו עלי",
    cache: emptyCache,
  }).arabicName,
  "أحمد أبو علي",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "John Smith",
    storedArabic: "جون سميث",
    cache: emptyCache,
  }).source,
  "stored_arabic",
);

assert.equal(
  getArabicDisplayName({
    context: "customer",
    originalText: "John Smith",
    cache: new Map([
      [
        "john smith",
        { arabicName: "جون سميث", isManualOverride: true },
      ],
    ]),
  }).source,
  "manual_cache",
);

assert.equal(suggestArabicCustomerName("Mohammad Ali").suggested, "محمد علي");
assert.equal(transliterateHebrewToArabic("אחמד חטיב").suggested, "أحمد خطيب");

console.log("✓ arabic-display-name tests passed");
