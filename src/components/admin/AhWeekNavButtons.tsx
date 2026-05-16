"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  iconSize?: number;
  variant?: "chevron" | "angle";
};

function PrevIcon({ variant, size }: { variant: "chevron" | "angle"; size: number }) {
  if (variant === "angle") return <span aria-hidden>◀</span>;
  return <ChevronLeft size={size} strokeWidth={2.4} aria-hidden />;
}

function NextIcon({ variant, size }: { variant: "chevron" | "angle"; size: number }) {
  if (variant === "angle") return <span aria-hidden>▶</span>;
  return <ChevronRight size={size} strokeWidth={2.4} aria-hidden />;
}

/** שמאל (פיזי) = שבוע קודם — תמיד בתוך מעטפת dir=ltr */
export function AhWeekNavPrevButton({
  iconSize = 14,
  variant = "chevron",
  className,
  type = "button",
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={className}
      aria-label={rest["aria-label"] ?? "שבוע קודם"}
      title={rest.title ?? "שבוע קודם"}
      {...rest}
    >
      <PrevIcon variant={variant} size={iconSize} />
    </button>
  );
}

/** ימין (פיזי) = שבוע הבא */
export function AhWeekNavNextButton({
  iconSize = 14,
  variant = "chevron",
  className,
  type = "button",
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={className}
      aria-label={rest["aria-label"] ?? "שבוע הבא"}
      title={rest.title ?? "שבוע הבא"}
      {...rest}
    >
      <NextIcon variant={variant} size={iconSize} />
    </button>
  );
}

export type AhWeekNavBarProps = {
  onPrev: () => void;
  onNext: () => void;
  children?: ReactNode;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  variant?: "chevron" | "angle";
  iconSize?: number;
  onPrevMouseDown?: ButtonHTMLAttributes<HTMLButtonElement>["onMouseDown"];
  onNextMouseDown?: ButtonHTMLAttributes<HTMLButtonElement>["onMouseDown"];
};

/** שורת ניווט: [◀ קודם] …children… [הבא ▶] — כיוון LTR קבוע */
export function AhWeekNavBar({
  onPrev,
  onNext,
  children,
  className,
  buttonClassName,
  disabled,
  prevDisabled,
  nextDisabled,
  variant = "chevron",
  iconSize = 14,
  onPrevMouseDown,
  onNextMouseDown,
}: AhWeekNavBarProps) {
  return (
    <div className={className ? `ah-week-nav-bar ${className}` : "ah-week-nav-bar"} dir="ltr">
      <AhWeekNavPrevButton
        className={buttonClassName}
        disabled={disabled || prevDisabled}
        variant={variant}
        iconSize={iconSize}
        onMouseDown={onPrevMouseDown}
        onClick={onPrev}
      />
      {children}
      <AhWeekNavNextButton
        className={buttonClassName}
        disabled={disabled || nextDisabled}
        variant={variant}
        iconSize={iconSize}
        onMouseDown={onNextMouseDown}
        onClick={onNext}
      />
    </div>
  );
}
