import "./data-table.css";

type Props = {
  /** מספר עמודות (כולל checkbox / actions אם מוצגים ב-head) */
  columnCount: number;
  rowCount?: number;
};

export function TableSkeleton({ columnCount, rowCount = 7 }: Props) {
  const rows = Math.min(12, Math.max(5, rowCount));
  return (
    <tbody className="adm-dt-sk-body" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="adm-dt-sk-row">
          {Array.from({ length: columnCount }).map((__, j) => (
            <td key={j}>
              <span className="adm-dt-sk-cell" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
