import "./data-table.css";

type Props = { message?: string };

export function TableEmpty({ message = "אין נתונים להצגה." }: Props) {
  return (
    <div className="adm-dt-empty" role="status">
      {message}
    </div>
  );
}
