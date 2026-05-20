"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  className?: string;
  dir?: "ltr" | "rtl";
};

/** תצוגת סכום עם pulse עדין בעת שינוי — UI בלבד */
export function AnimatedMoneyValue({ value, className = "", dir }: Props) {
  const [pulse, setPulse] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 480);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <span
      dir={dir}
      className={["money-amount", pulse ? "money-amount--pulse" : "", className].filter(Boolean).join(" ")}
    >
      {value}
    </span>
  );
}
