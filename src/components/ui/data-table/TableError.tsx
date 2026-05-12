import "./data-table.css";

type Props = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export function TableError({ message, onRetry, retryLabel = "טעינה מחדש" }: Props) {
  return (
    <div className="adm-dt-error" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
