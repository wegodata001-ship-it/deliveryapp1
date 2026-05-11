import type { CSSProperties } from "react";

type Props = {
  size?: "sm" | "md";
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

export function InlineSpinner({ size = "sm", className = "", style, "aria-label": ariaLabel = "טוען" }: Props) {
  const cls = size === "md" ? "ui-spin ui-spin--md" : "ui-spin";
  return <span className={`${cls} ${className}`.trim()} style={style} role="img" aria-label={ariaLabel} />;
}
