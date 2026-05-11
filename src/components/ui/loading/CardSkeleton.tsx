type Props = {
  count?: number;
  className?: string;
};

export function CardSkeleton({ count = 4, className = "" }: Props) {
  return (
    <div className={`ui-card-skeleton-grid ${className}`.trim()} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ui-card-skeleton">
          <div className="ui-card-skeleton__line ui-card-skeleton__line--short" />
          <div className="ui-card-skeleton__line ui-card-skeleton__line--lg" />
          <div className="ui-card-skeleton__line ui-card-skeleton__line--mid" />
        </div>
      ))}
    </div>
  );
}
