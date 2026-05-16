import { formatMoneyAmount, formatMoneyFromString, formatIlsDisplay, formatUsdDisplay } from "@/lib/money-format";

type Props = {
  amount: number | string | null | undefined;
  currency?: "ILS" | "USD" | "none";
  fractionDigits?: number;
  className?: string;
};

/** Read-only money display with thousand separators. */
export function MoneyText({ amount, currency = "none", fractionDigits = 2, className }: Props) {
  let text: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) text = "—";
    else if (currency === "ILS") text = formatIlsDisplay(amount);
    else if (currency === "USD") text = formatUsdDisplay(amount);
    else text = formatMoneyAmount(amount, fractionDigits);
  } else {
    const n = formatMoneyFromString(amount ?? "", fractionDigits);
    if (currency === "ILS" && n !== "—") text = `₪ ${n}`;
    else if (currency === "USD" && n !== "—") text = `$ ${n}`;
    else text = n;
  }
  return (
    <span className={className} dir="ltr">
      {text}
    </span>
  );
}
