import { WegoWMarkSvg } from "@/components/brand/WegoWMarkSvg";

/** לוגו W — ריבוע מעוגל, גרדיאנט כחול, סגנון ERP */
export function WegoBrandLogo({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <div
      className={`adm-brand-logo adm-brand-logo--erp${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      <WegoWMarkSvg size={size} />
    </div>
  );
}
