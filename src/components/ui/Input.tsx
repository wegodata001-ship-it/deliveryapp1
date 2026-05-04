import { forwardRef, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & { className?: string };

export const Input = forwardRef<HTMLInputElement, Props>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`input ${className}`.trim()} {...props} />;
});
