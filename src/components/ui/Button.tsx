import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";

type Props = {
  children: ReactNode;
  variant?: Variant;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ children, variant = "primary", className = "", type = "button", ...props }: Props) {
  return (
    <button type={type} className={`btn btn-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
