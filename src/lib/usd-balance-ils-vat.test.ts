import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convertDebtUsdToIlsIncludingVat,
  convertUsdBalanceToIlsVat,
  convertUsdToIlsNet,
  formatIlsGrossWithVatDisplay,
} from "@/lib/usd-balance-ils-vat";

describe("convertDebtUsdToIlsIncludingVat", () => {
  it("Debt $22,881.55 @ 3.00 → net / VAT / gross", () => {
    const usd = 22881.55;
    const rate = 3;
    const ilsNet = convertUsdToIlsNet(usd, rate);
    const ilsGross = convertDebtUsdToIlsIncludingVat(usd, rate);
    const vat = convertUsdBalanceToIlsVat(usd, rate);

    assert.equal(ilsNet, 68644.65);
    assert.equal(vat.vatIls, 12356.04);
    assert.equal(ilsGross, 81000.69);
    assert.equal(vat.ilsGrossWithVat, 81000.69);
    assert.equal(formatIlsGrossWithVatDisplay(ilsGross), "₪ 81,000.69 כולל מע״מ");
  });

  it("does not apply VAT twice on the same USD", () => {
    const once = convertDebtUsdToIlsIncludingVat(22881.55, 3);
    const twice = convertDebtUsdToIlsIncludingVat(once, 3);
    assert.notEqual(once, twice);
    assert.equal(once, 81000.69);
  });

  it("rate change updates ILS; USD argument is unchanged", () => {
    const usd = 22881.55;
    const at3 = convertDebtUsdToIlsIncludingVat(usd, 3);
    const at4 = convertDebtUsdToIlsIncludingVat(usd, 4);
    assert.equal(usd, 22881.55);
    assert.equal(at3, 81000.69);
    assert.equal(at4, 108000.92);
  });

  it("invalid rate → 0", () => {
    assert.equal(convertDebtUsdToIlsIncludingVat(100, 0), 0);
    assert.equal(convertDebtUsdToIlsIncludingVat(100, NaN), 0);
  });
});
