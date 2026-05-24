export default function CustomerCardLoading() {
  return (
    <div className="adm-customer-card-page adm-customer-card-page--loading" aria-busy="true">
      <div className="adm-source-cards-skeleton" style={{ maxWidth: 720 }}>
        <div className="adm-source-card-skeleton" />
        <div className="adm-source-card-skeleton" />
      </div>
    </div>
  );
}
