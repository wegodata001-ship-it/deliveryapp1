import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InlineSpinner } from "./InlineSpinner";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: ReactNode;
  children: ReactNode;
};

export function LoadingButton({ loading, loadingLabel, children, disabled, className = "", ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`ui-loading-btn ${loading ? "ui-loading-btn--busy" : ""} ${className}`.trim()}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <InlineSpinner size="sm" className="ui-loading-btn__spin" aria-label="" />
          <span>{loadingLabel ?? "טוען…"}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
