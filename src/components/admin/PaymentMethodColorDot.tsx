"use client";

import { getPaymentMethodUI } from "@/lib/payment-method-ui";

type Props = {
  method: string | null | undefined;
  label?: string | null;
  showLabel?: boolean;
  size?: number;
  className?: string;
};

/** נקודת צבע + תווית לפי SSOT של אמצעי תשלום */
export function PaymentMethodColorDot({
  method,
  label,
  showLabel = true,
  size = 8,
  className,
}: Props) {
  const ui = getPaymentMethodUI(method, label ?? undefined);
  return (
    <span className={["pm-color-dot-wrap", className].filter(Boolean).join(" ")}>
      <span
        className="pm-color-dot"
        style={{ backgroundColor: ui.textColor, width: size, height: size }}
        aria-hidden
      />
      {showLabel ? <span className="pm-color-dot-wrap__label">{ui.label}</span> : null}
    </span>
  );
}
