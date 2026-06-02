import { TableSkeleton } from "@/components/ui/data-table";

export default function SourceTableLoading() {
  return (
    <div className="adm-source-page adm-page--page-scroll">
      <header className="adm-source-detail-head">
        <div className="adm-source-detail-head__skeleton">
          <span className="adm-source-shim adm-source-shim--back" />
          <span className="adm-source-shim adm-source-shim--title" />
          <span className="adm-source-shim adm-source-shim--sub" />
        </div>
      </header>
      <div className="adm-source-pro adm-source-pro--shell">
        <div className="adm-source-pro-toolbar">
          <span className="adm-source-shim adm-source-shim--input" />
          <span className="adm-source-shim adm-source-shim--btn" />
        </div>
        <div className="adm-source-pro-table-wrap">
          <table className="adm-table adm-source-pro-table">
            <thead>
              <tr>
                {Array.from({ length: 8 }).map((_, i) => (
                  <th key={i}>
                    <span className="adm-source-shim adm-source-shim--th" />
                  </th>
                ))}
              </tr>
            </thead>
            <TableSkeleton columnCount={8} rowCount={7} />
          </table>
        </div>
      </div>
    </div>
  );
}
