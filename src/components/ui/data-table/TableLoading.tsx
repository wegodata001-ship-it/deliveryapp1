import "./data-table.css";

type Props = {
  label?: string;
  className?: string;
};

export function TableLoading({ label = "טוען נתונים…", className }: Props) {
  return (
    <div className={["adm-dt-loading-layer", className].filter(Boolean).join(" ")} role="status" aria-live="polite">
      <span className="adm-dt-spinner" aria-hidden />
      <span className="adm-dt-loading-layer__text">{label}</span>
    </div>
  );
}
