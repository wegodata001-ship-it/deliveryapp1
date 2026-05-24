import { SourceTablesCardsSkeleton } from "@/components/admin/SourceTablesCardsSkeleton";

export default function SourceTablesLoading() {
  return (
    <div className="adm-source-page">
      <header className="adm-source-head">
        <h1>טבלאות מקור</h1>
        <p>גישה ברורה לטבלאות השוטפות וטבלאות המערכת, בעיצוב מודרני ונוח.</p>
      </header>
      <SourceTablesCardsSkeleton />
    </div>
  );
}
