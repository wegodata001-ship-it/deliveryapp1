import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/admin/AdminWindowBodies.tsx");
let s = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");

if (!s.includes("setEditOpen")) {
  console.log("already patched");
  process.exit(0);
}

const EDIT_FIELDS = `  const editFields = (
    <div className="adm-cust-inline-edit-form form-grid">
      <motion.div className="form-field">
        <label htmlFor="cust-name">שם מלא</label>
        <input id="cust-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
      </div>
      <div className="form-field">
        <label htmlFor="cust-name-ar">שם בערבית</label>
        <input
          id="cust-name-ar"
          dir="rtl"
          placeholder="הזן שם בערבית"
          value={form.nameAr}
          onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
        />
      </div>
      <div className="form-field">
        <label htmlFor="cust-name-en">שם באנגלית</label>
        <input
          id="cust-name-en"
          dir="ltr"
          placeholder="Enter English name"
          value={form.nameEn}
          onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
        />
      </div>
      <div className="form-field">
        <label htmlFor="cust-phone">טלפון</label>
        <input id="cust-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} dir="ltr" />
      </div>
      <div className="form-field">
        <label htmlFor="cust-number">קוד לקוח</label>
        <input id="cust-number" value={form.customerCode} onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))} dir="ltr" />
      </motion.div>
      <div className="form-field form-field--wide">
        <label htmlFor="cust-address">כתובת</label>
        <input id="cust-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
      </div>
    </div>
  );
`;

// strip any accidental motion. prefix from template literals above
const editFieldsBlock = EDIT_FIELDS.split("\n")
  .map((line) => line.replace(/<\/?motion\.div/g, (m) => m.replace("motion.", "")))
  .join("\n");

const returnStart = s.indexOf('  return (\n    <div className="adm-win-scroll-body adm-cust-card-body">');
if (returnStart < 0) {
  console.error("return block not found");
  process.exit(1);
}

s = s.slice(0, returnStart) + editFieldsBlock + "\n\n" + s.slice(returnStart);

const headerOld = `      <div className="adm-cust-card-shell">
        <div className="client-header">
          <div className="client-actions">
            <button type="button" className="btn-outline" onClick={() => setEditOpen(true)}>
              ערוך לקוח
            </button>
          </div>
          <div className="client-title">
            <h1>{snap.displayName || customerName || "—"}</h1>
            <span dir="ltr">{displayCustomerCode(snap)}</span>
          </div>
        </div>`;

const headerNew = `      <div className={["adm-cust-card-shell", editMode ? "adm-cust-card-shell--edit" : ""].filter(Boolean).join(" ")}>
        <div className={["client-header", editMode ? "client-header--edit" : ""].filter(Boolean).join(" ")}>
          <div className="client-actions">
            {editMode ? (
              <>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEdit}>
                  ביטול
                </button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveDetails()}>
                  {saving ? "שומר…" : "שמור"}
                </button>
              </>
            ) : (
              <button type="button" className="btn-outline" onClick={startEdit}>
                ערוך לקוח
              </button>
            )}
          </div>
          <div className="client-title">
            {editMode ? (
              <>
                <h1>עריכת פרטי לקוח</h1>
                <span dir="ltr">{form.customerCode.trim() || displayCustomerCode(snap)}</span>
              </>
            ) : (
              <>
                <h1>{snap.displayName || customerName || "—"}</h1>
                <span dir="ltr">{displayCustomerCode(snap)}</span>
              </>
            )}
          </div>
        </div>`;

const detailsOld = `        {activeTab === "details" ? (
          <section className="adm-cust-tab-panel">
            <div className="client-info-card">
              <div className="info-item">
                <label>כתובת</label>
                <div>{snap.address?.trim() || snap.city?.trim() || "—"}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>קוד לקוח</label>
                <div dir="ltr">{displayCustomerCode(snap)}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>טלפון</label>
                <div dir="ltr">{snap.phone?.trim() || "—"}</motion.div>
              </div>
            </div>
          </section>
        ) : null}`;

const detailsOldClean = detailsOld.replace("</motion.div>", "</motion.div>").replace("</motion.div>", "</div>");

const detailsNew = `        {activeTab === "details" ? (
          <section className="adm-cust-tab-panel">
            {editMode ? (
              <div className="adm-cust-inline-edit-panel">{editFields}</div>
            ) : (
              <div className="client-info-card">
                <div className="info-item">
                  <label>כתובת</label>
                  <motion.div>{snap.address?.trim() || snap.city?.trim() || "—"}</div>
                </div>
                <div className="info-divider" />
                <div className="info-item">
                  <label>קוד לקוח</label>
                  <div dir="ltr">{displayCustomerCode(snap)}</div>
                </div>
                <div className="info-divider" />
                <div className="info-item">
                  <label>טלפון</label>
                  <div dir="ltr">{snap.phone?.trim() || "—"}</div>
                </div>
                {(snap.nameAr?.trim() || snap.nameEn?.trim() || snap.nameHe?.trim()) ? (
                  <>
                    <div className="info-divider" />
                    <div className="info-item">
                      <label>שמות נוספים</label>
                      <div>
                        {[snap.nameAr?.trim(), snap.nameEn?.trim() || snap.nameHe?.trim()].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        ) : null}`;

const detailsNewClean = detailsNew
  .split("\n")
  .map((line) => line.replace(/<\/?motion\.div/g, (m) => m.replace("motion.", "")))
  .join("\n");

if (!s.includes(headerOld)) {
  console.error("header block not found");
  process.exit(1);
}
s = s.replace(headerOld, headerNew);

const detailsOldFixed = `        {activeTab === "details" ? (
          <section className="adm-cust-tab-panel">
            <div className="client-info-card">
              <div className="info-item">
                <label>כתובת</label>
                <div>{snap.address?.trim() || snap.city?.trim() || "—"}</motion.div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>קוד לקוח</label>
                <div dir="ltr">{displayCustomerCode(snap)}</div>
              </div>
              <div className="info-divider" />
              <div className="info-item">
                <label>טלפון</label>
                <div dir="ltr">{snap.phone?.trim() || "—"}</div>
              </div>
            </div>
          </section>
        ) : null}`.replace(/<\/?motion\.div/g, (m) => m.replace("motion.", ""));

if (!s.includes(detailsOldFixed)) {
  console.error("details block not found");
  process.exit(1);
}
s = s.replace(detailsOldFixed, detailsNewClean);

const modalStart = s.indexOf("      {editOpen ? (");
const modalEnd = s.indexOf("      <OrderEditLockGateModal", modalStart);
if (modalStart < 0 || modalEnd < 0) {
  console.error("modal block not found");
  process.exit(1);
}
s = s.slice(0, modalStart) + s.slice(modalEnd);

fs.writeFileSync(target, s);
console.log("inline edit patched");
