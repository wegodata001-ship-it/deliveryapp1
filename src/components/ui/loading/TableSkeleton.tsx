type Props = {
  rows?: number;
  columns?: number;
  className?: string;
};

/** שורות skeleton בלבד — לשים בתוך &lt;tbody&gt; */
export function TableSkeleton({ rows = 6, columns = 8, className = "" }: Props) {
  return (
    <>
      {Array.from({ length: rows }).map((_, ri) => (
        <tr key={ri} className={`ui-table-skeleton-row ${className}`.trim()} aria-hidden>
          {Array.from({ length: columns }).map((_, ci) => (
            <td key={ci}>
              <span className="ui-table-skeleton__cell" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
