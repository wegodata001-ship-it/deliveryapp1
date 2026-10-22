"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Search,
  Table2,
} from "lucide-react";
import {
  DOCUMENT_DOC_TYPES,
  DOCUMENT_ENTITY_LABELS,
  DOCUMENT_ENTITY_TYPES,
} from "@/lib/documents/constants";
import {
  documentsArchiveHref,
  parseDocumentsArchiveFilter,
  type DocumentsArchiveFilterState,
} from "@/lib/documents/intake-capture";
import { WORK_WEEK_CODES_SORTED } from "@/lib/work-week";
import {
  listArchiveDocumentsAction,
  type DocumentDto,
} from "@/app/admin/documents/actions";
import { DocumentViewerModal } from "@/components/admin/DocumentViewerModal";

function KindIcon({ kind }: { kind: DocumentDto["kind"] }) {
  if (kind === "image") return <ImageIcon size={15} aria-hidden />;
  if (kind === "excel") return <FileSpreadsheet size={15} aria-hidden />;
  if (kind === "pdf" || kind === "word") return <FileText size={15} aria-hidden />;
  return <FileIcon size={15} aria-hidden />;
}

function fmtDate(iso: string, ymd?: string | null): string {
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function DocumentsArchiveClient({
  canDelete,
  canDownload,
  canUpload,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canUpload: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = useMemo(
    () => parseDocumentsArchiveFilter(searchParams),
    [searchParams],
  );

  const [draft, setDraft] = useState<DocumentsArchiveFilterState>(filter);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(40);
  const [kpis, setKpis] = useState({
    total: 0,
    weekCount: 0,
    weekCode: "",
    paymentCount: 0,
    orderCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<DocumentDto | null>(null);

  useEffect(() => {
    setDraft(filter);
  }, [filter]);

  const replaceFilter = useCallback(
    (next: DocumentsArchiveFilterState) => {
      const href = documentsArchiveHref(next);
      const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
      if (href !== current) router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await listArchiveDocumentsAction({
      search: filter.q || null,
      entityType: filter.entityType || null,
      docType: filter.docType || null,
      weekCode: filter.weekCode || null,
      fromYmd: filter.fromYmd || null,
      toYmd: filter.toYmd || null,
      uploadedBy: filter.uploadedBy || null,
      page: filter.page,
    });
    if (res.ok) {
      setDocs(res.result.documents);
      setTotal(res.result.total);
      setPageSize(res.result.pageSize);
      setKpis(res.result.kpis);
    } else {
      setErr(res.error);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyDraft(patch: Partial<DocumentsArchiveFilterState>) {
    replaceFilter({ ...draft, ...patch, page: patch.page ?? 1 });
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const weekOptions = useMemo(() => {
    const set = new Set(WORK_WEEK_CODES_SORTED);
    if (draft.weekCode) set.add(draft.weekCode);
    return [...set];
  }, [draft.weekCode]);

  return (
    <div className="adm-docarc" dir="rtl">
      <div className="adm-docarc__head">
        <h1 className="adm-docarc__title">
          <Archive size={20} aria-hidden /> ארכיון מסמכים
        </h1>
        <div className="adm-docarc__head-actions">
          <button
            type="button"
            className={`adm-docs__btn ${filter.view === "table" ? "adm-docs__btn--primary" : ""}`}
            onClick={() => applyDraft({ view: "table", page: filter.page })}
          >
            <Table2 size={14} /> טבלה
          </button>
          <button
            type="button"
            className={`adm-docs__btn ${filter.view === "cards" ? "adm-docs__btn--primary" : ""}`}
            onClick={() => applyDraft({ view: "cards", page: filter.page })}
          >
            <LayoutGrid size={14} /> כרטיסים
          </button>
        </div>
      </div>

      <div className="adm-docarc__kpis">
        <div className="adm-docarc__kpi">
          <span>סך מסמכים</span>
          <strong>{kpis.total}</strong>
        </div>
        <div className="adm-docarc__kpi">
          <span>מסמכים {filter.weekCode ? `בשבוע ${filter.weekCode}` : `בשבוע ${kpis.weekCode}`}</span>
          <strong>{kpis.weekCount}</strong>
        </div>
        <div className="adm-docarc__kpi">
          <span>מסמכי תשלומים</span>
          <strong>{kpis.paymentCount}</strong>
        </div>
        <div className="adm-docarc__kpi">
          <span>מסמכי הזמנות</span>
          <strong>{kpis.orderCount}</strong>
        </div>
      </div>

      <div className="adm-docarc__filters">
        <label className="adm-docarc__f adm-docarc__f--grow">
          <span>חיפוש</span>
          <span className="adm-docarc__searchwrap">
            <Search size={14} aria-hidden />
            <input
              type="text"
              value={draft.q}
              onChange={(e) => setDraft((c) => ({ ...c, q: e.target.value }))}
              onBlur={() => applyDraft({ q: draft.q })}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyDraft({ q: draft.q });
              }}
              placeholder="קוד לקוח / שם / הזמנה / תשלום / משתמש"
            />
          </span>
        </label>
        <label className="adm-docarc__f">
          <span>סוג ישות</span>
          <select value={draft.entityType} onChange={(e) => applyDraft({ entityType: e.target.value })}>
            <option value="">הכל</option>
            {DOCUMENT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_ENTITY_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-docarc__f">
          <span>סוג מסמך</span>
          <select value={draft.docType} onChange={(e) => applyDraft({ docType: e.target.value })}>
            <option value="">הכל</option>
            {DOCUMENT_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-docarc__f">
          <span>שבוע עבודה</span>
          <select value={draft.weekCode} onChange={(e) => applyDraft({ weekCode: e.target.value })}>
            <option value="">כל השבועות</option>
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-docarc__f">
          <span>מתאריך</span>
          <input type="date" value={draft.fromYmd} onChange={(e) => applyDraft({ fromYmd: e.target.value })} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>עד תאריך</span>
          <input type="date" value={draft.toYmd} onChange={(e) => applyDraft({ toYmd: e.target.value })} dir="ltr" />
        </label>
        <label className="adm-docarc__f">
          <span>הועלה ע״י</span>
          <input
            type="text"
            value={draft.uploadedBy}
            onChange={(e) => setDraft((c) => ({ ...c, uploadedBy: e.target.value }))}
            onBlur={() => applyDraft({ uploadedBy: draft.uploadedBy })}
            placeholder="שם משתמש"
          />
        </label>
      </div>

      {err ? <div className="adm-docs__err">{err}</div> : null}

      {filter.view === "cards" ? (
        <div className="adm-docarc__cards">
          {loading ? (
            <p className="adm-docs__empty">טוען…</p>
          ) : docs.length === 0 ? (
            <p className="adm-docs__empty">לא נמצאו מסמכים.</p>
          ) : (
            docs.map((d) => (
              <button key={d.id} type="button" className="adm-docarc__card" onClick={() => setActive(d)}>
                <span className="adm-docarc__thumb">
                  {d.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/documents/${d.id}/download`} alt="" loading="lazy" />
                  ) : (
                    <KindIcon kind={d.kind} />
                  )}
                </span>
                <span className="adm-docarc__card-body">
                  <strong>{d.docTypeLabel !== "—" ? d.docTypeLabel : d.fileName}</strong>
                  <em>{d.customerName || d.entityTypeLabel}</em>
                  <small>
                    {fmtDate(d.createdAtIso, d.sourceDateYmd)}
                    {d.sourceNumber ? ` · ${d.sourceNumber}` : ""}
                    {d.weekCode ? ` · ${d.weekCode}` : ""}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="adm-table-excel-wrap">
          <table className="adm-table-excel">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>לקוח</th>
                <th>סוג מסמך</th>
                <th>מספר מקור</th>
                <th>שבוע</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="adm-table-empty">
                    טוען…
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="adm-table-empty">
                    לא נמצאו מסמכים.
                  </td>
                </tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id}>
                    <td dir="ltr">{fmtDate(d.createdAtIso, d.sourceDateYmd)}</td>
                    <td>
                      {d.customerName || "—"}
                      {d.customerCode ? (
                        <span className="adm-docarc__entityid" dir="ltr">
                          {" "}
                          {d.customerCode}
                        </span>
                      ) : null}
                    </td>
                    <td>{d.docTypeLabel !== "—" ? d.docTypeLabel : d.entityTypeLabel}</td>
                    <td dir="ltr">{d.sourceNumber || d.entityId}</td>
                    <td dir="ltr">{d.weekCode || "—"}</td>
                    <td>
                      <div className="adm-docs__actions">
                        <button type="button" className="adm-docs__iconbtn" onClick={() => setActive(d)} title="צפייה">
                          <FileText size={15} />
                        </button>
                        {canDownload ? (
                          <a
                            className="adm-docs__iconbtn"
                            href={`/api/documents/${d.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="הורדה"
                          >
                            <Download size={15} aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="adm-docarc__pager">
          <button
            type="button"
            className="adm-docs__btn"
            disabled={filter.page <= 1}
            onClick={() => applyDraft({ page: filter.page - 1 })}
          >
            הקודם
          </button>
          <span>
            עמוד {filter.page} מתוך {pages}
          </span>
          <button
            type="button"
            className="adm-docs__btn"
            disabled={filter.page >= pages}
            onClick={() => applyDraft({ page: filter.page + 1 })}
          >
            הבא
          </button>
        </div>
      ) : null}

      <DocumentViewerModal
        doc={active}
        canDownload={canDownload}
        canDelete={canDelete}
        canEdit={canUpload}
        onClose={() => setActive(null)}
        onChanged={(next) => {
          setDocs((cur) => cur.map((d) => (d.id === next.id ? next : d)));
          setActive(next);
        }}
        onDeleted={(id) => setDocs((cur) => cur.filter((d) => d.id !== id))}
      />
    </div>
  );
}

export default DocumentsArchiveClient;
