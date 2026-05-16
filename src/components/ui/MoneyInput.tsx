"use client";

import {
  forwardRef,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  applyMoneyInputEdit,
  canonicalMoneyToNumber,
  canonicalizeMoneyInput,
  formatMoneyInputCanonical,
} from "@/lib/money-format";

export type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  /** Numeric value only — never pass formatted strings. */
  value: number | null;
  onChange: (value: number | null) => void;
  allowEmpty?: boolean;
};

function displayFromValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatMoneyInputCanonical(canonicalizeMoneyInput(String(value)));
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, allowEmpty = true, disabled, className, onBlur, ...rest },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);
  const pendingCursor = useRef<number | null>(null);
  const lastEmitted = useRef<number | null | undefined>(undefined);
  const [display, setDisplay] = useState(() => displayFromValue(value));

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el == null || pendingCursor.current == null) return;
    const pos = pendingCursor.current;
    pendingCursor.current = null;
    el.setSelectionRange(pos, pos);
  });

  useEffect(() => {
    if (lastEmitted.current === value) return;
    setDisplay(displayFromValue(value));
  }, [value]);

  function emitFromCanonical(canonical: string) {
    const n = canonicalMoneyToNumber(canonical);
    if (n == null) {
      lastEmitted.current = allowEmpty ? null : 0;
      onChange(allowEmpty ? null : 0);
      return;
    }
    lastEmitted.current = n;
    onChange(n);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const pos = el.selectionStart ?? el.value.length;
    const { display: nextDisplay, canonical, cursor } = applyMoneyInputEdit(el.value, pos);
    pendingCursor.current = cursor;
    setDisplay(nextDisplay);
    emitFromCanonical(canonical);
  }

  function handleBlur(e: FocusEvent<HTMLInputElement>) {
    const canonical = canonicalizeMoneyInput(display);
    const n = canonicalMoneyToNumber(canonical);
    if (n != null) {
      const full = formatMoneyInputCanonical(canonicalizeMoneyInput(String(n)));
      setDisplay(full);
    } else if (!allowEmpty) {
      setDisplay("0.00");
      lastEmitted.current = 0;
      onChange(0);
    } else {
      setDisplay("");
    }
    onBlur?.(e);
  }

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      dir="ltr"
      disabled={disabled}
      className={className}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});
