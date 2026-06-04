export default function OrdersListLoading() {
  return (
    <div className="adm-orders-excel-page adm-orders-excel-page--loading" aria-busy="true" aria-label="טוען רשימת הזמנות">
      <div className="adm-orders-toolbar-skel" />
      <div className="adm-orders-main-panel">
        <div className="adm-orders-action-kpi-row">
          <div className="adm-orders-status-kpi adm-orders-status-kpi--board adm-orders-status-kpi--skel">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="adm-status-card adm-status-card--erp adm-status-card--skel" />
            ))}
          </div>
        </div>
      </div>
      <div className="adm-table-excel-wrap adm-table-excel-wrap--skel">
        <div className="adm-orders-table-skel" />
      </div>
    </div>
  );
}
