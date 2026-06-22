import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import { createDocument } from "@/lib/documents/service";
import {
  allowedExtensionsFromEnv,
  maxUploadMbFromEnv,
  storageConfigured,
} from "@/lib/documents/storage";
import { fileExtensionOf, isDocumentEntityType } from "@/lib/documents/constants";

export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["documents.upload"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }
    if (!storageConfigured()) {
      return NextResponse.json(
        { ok: false, error: "אחסון מסמכים אינו מוגדר (Supabase Storage)" },
        { status: 503 },
      );
    }
    await ensureDocumentsTable();

    const form = await req.formData();
    const entityType = String(form.get("entityType") ?? "").trim();
    const entityId = String(form.get("entityId") ?? "").trim();
    const docTypeRaw = form.get("docType");
    const docType = docTypeRaw ? String(docTypeRaw).trim() || null : null;

    if (!isDocumentEntityType(entityType)) {
      return NextResponse.json({ ok: false, error: "סוג ישות לא תקין" }, { status: 400 });
    }
    if (!entityId) {
      return NextResponse.json({ ok: false, error: "חסר מזהה ישות" }, { status: 400 });
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "לא התקבלו קבצים" }, { status: 400 });
    }

    const allowed = allowedExtensionsFromEnv();
    const maxMb = maxUploadMbFromEnv();
    const maxBytes = maxMb * 1024 * 1024;

    for (const file of files) {
      const ext = fileExtensionOf(file.name);
      if (allowed.length > 0 && !allowed.includes(ext)) {
        return NextResponse.json(
          { ok: false, error: `סוג קובץ לא נתמך: .${ext || "?"}` },
          { status: 400 },
        );
      }
      if (file.size > maxBytes) {
        return NextResponse.json(
          { ok: false, error: `הקובץ "${file.name}" חורג מהמותר (${maxMb}MB)` },
          { status: 400 },
        );
      }
    }

    const created = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dto = await createDocument({
        entityType,
        entityId,
        docType,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes,
        uploadedById: me.id,
        uploadedByName: me.fullName ?? me.username ?? null,
      });
      created.push(dto);
    }

    return NextResponse.json({ ok: true, documents: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "העלאה נכשלה";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
