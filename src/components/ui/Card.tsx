import type { HTMLAttributes, ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className">;

export default function Card({ children, className = "", ...rest }: Props) {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
