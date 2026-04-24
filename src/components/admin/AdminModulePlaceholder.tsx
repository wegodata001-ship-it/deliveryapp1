import { Construction } from "lucide-react";

export function AdminModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="adm-placeholder">
      <Construction size={40} style={{ marginBottom: "0.75rem", opacity: 0.35 }} aria-hidden />
      <h2 style={{ margin: 0, fontSize: "1.15rem", color: "var(--adm-text)" }}>{title}</h2>
      {description ? (
        <p style={{ margin: "0.5rem 0 0", maxWidth: "420px", marginInline: "auto", lineHeight: 1.5 }}>{description}</p>
      ) : null}
    </div>
  );
}
