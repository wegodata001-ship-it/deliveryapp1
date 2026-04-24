"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import "./workflow.css";

export type DemoOrder = {
  num: string;
  cust: string;
  custCode: string;
  week: string;
  usd: string;
  ils: string;
  status: string;
  pointName: string;
};

const demoOrders: DemoOrder[] = [
  {
    num: "AH-118-0142",
    cust: "לקוח דמו א׳",
    custCode: "C-1001",
    week: "AH-118",
    usd: "1,240",
    ils: "4,526",
    status: "פתוחה",
    pointName: "נקודת דמו — דיזנגוף",
  },
  {
    num: "AH-118-0141",
    cust: "לקוח דמו ב׳",
    custCode: "C-1002",
    week: "AH-118",
    usd: "890",
    ils: "3,248",
    status: "ממתינה לביצוע",
    pointName: "נקודת דמו — חולון",
  },
  {
    num: "AH-117-0999",
    cust: "לקוח דמו ג׳",
    custCode: "C-1003",
    week: "AH-117",
    usd: "2,100",
    ils: "7,665",
    status: "נשלחה",
    pointName: "נקודת דמו — באר שבע",
  },
];

export type DemoPayment = {
  id: string;
  cust: string;
  custCode: string;
  order: string | null;
  ils: string;
  usd: string;
  method: string;
  paid: boolean;
  pointName: string;
  date: string;
};

const demoRecentPayments: DemoPayment[] = [
  {
    id: "P-8821",
    cust: "לקוח דמו א׳",
    custCode: "C-1001",
    order: "AH-118-0142",
    ils: "4,520",
    usd: "1,240",
    method: "העברה בנקאית",
    paid: true,
    pointName: "בנק דמו",
    date: "24.04.2026",
  },
  {
    id: "P-8820",
    cust: "לקוח דמו ב׳",
    custCode: "C-1002",
    order: "AH-118-0141",
    ils: "3,265",
    usd: "890",
    method: "נקודת תשלום",
    paid: false,
    pointName: "נקודת דמו — חולון",
    date: "23.04.2026",
  },
];

const demoReceipt = [
  { week: "AH-118", expected: "₪ 48,200", received: "₪ 47,850", diff: "₪ 350", note: "הפרש קל" },
  { week: "AH-117", expected: "₪ 52,900", received: "₪ 52,900", diff: "₪ 0", note: "מאוזן" },
];

const demoLedger = [
  { date: "22.04", ref: "הזמנה AH-118-0142", debit: "₪ 4,520", credit: "—", bal: "₪ 12,400" },
  { date: "21.04", ref: "תשלום P-8820", debit: "—", credit: "₪ 3,265", bal: "₪ 7,880" },
  { date: "20.04", ref: "הזמנה AH-118-0140", debit: "₪ 2,100", credit: "—", bal: "₪ 11,145" },
];

const demoBalances = [
  { cust: "לקוח דמו א׳", code: "C-1001", ils: "₪ 12,400", usd: "$ 3,200", risk: "תקין" },
  { cust: "לקוח דמו ב׳", code: "C-1002", ils: "₪ 2,150", usd: "$ 590", risk: "לטיפול" },
  { cust: "לקוח דמו ג׳", code: "C-1003", ils: "₪ 0", usd: "$ 0", risk: "תקין" },
];

const demoRaw = [
  { table: "הזמנות_ישן", legacyId: "ORD-9912", imported: "24.04.2026" },
  { table: "תשלומים_ישן", legacyId: "PAY-441", imported: "24.04.2026" },
];

function CustomerCardBody({ code }: { code: string }) {
  const name = demoOrders.find((o) => o.custCode === code)?.cust ?? "לקוח";
  return (
    <div>
      <p>
        <strong>קוד לקוח:</strong> {code}
      </p>
      <p>
        <strong>שם תצוגה:</strong> {name}
      </p>
      <p>
        <strong>טלפון:</strong> 050-0000000
      </p>
      <p>
        <strong>אזור:</strong> דמו
      </p>
      <p style={{ color: "var(--adm-muted)", fontSize: "0.85rem", marginTop: "1rem" }}>
        כרטסת מלאה תישאר ברקע; כאן תצוגת פרטים מהירה כמו באטלס.
      </p>
    </div>
  );
}

function AmountBreakdownBody({ title, ils, usd }: { title: string; ils: string; usd: string }) {
  return (
    <div>
      <p style={{ marginTop: 0 }}>{title}</p>
      <table className="wf-table" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
        <tbody>
          <tr>
            <th style={{ textAlign: "right", width: "40%" }}>סכום לפני מע״מ</th>
            <td className="wf-num">{ils}</td>
          </tr>
          <tr>
            <th>מע״מ (דמו 18%)</th>
            <td className="wf-num">חישוב יוצג כאן</td>
          </tr>
          <tr>
            <th>שקל ↔ דולר</th>
            <td className="wf-num">שער 3.65 · {usd}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OrderDetailBody({ order }: { order: DemoOrder }) {
  return (
    <div>
      <p>
        <strong>מספר הזמנה:</strong> {order.num}
      </p>
      <p>
        <strong>שבוע:</strong> {order.week}
      </p>
      <p>
        <strong>לקוח:</strong> {order.cust} ({order.custCode})
      </p>
      <p>
        <strong>נקודת מסירה:</strong> {order.pointName}
      </p>
      <p>
        <strong>סטטוס:</strong> {order.status}
      </p>
      <hr style={{ border: "none", borderTop: "1px solid var(--adm-border)", margin: "1rem 0" }} />
      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>היסטוריית שינויים (דמו)</p>
      <ul style={{ margin: 0, paddingRight: "1.1rem", color: "var(--adm-muted)", fontSize: "0.88rem" }}>
        <li>היום 09:10 — נוצרה הזמנה</li>
        <li>היום 09:22 — עודכן סטטוס</li>
      </ul>
    </div>
  );
}

function PaymentDetailBody({ pay }: { pay: DemoPayment }) {
  return (
    <div>
      <p>
        <strong>מזהה תשלום:</strong> {pay.id}
      </p>
      <p>
        <strong>תאריך:</strong> {pay.date}
      </p>
      <p>
        <strong>לקוח:</strong> {pay.cust} ({pay.custCode})
      </p>
      {pay.order ? (
        <p>
          <strong>הזמנה מקושרת:</strong> {pay.order}
        </p>
      ) : null}
      <p>
        <strong>סכומים:</strong> ₪ {pay.ils} · ${pay.usd}
      </p>
      <p>
        <strong>אמצעי:</strong> {pay.method} · <strong>שולם:</strong> {pay.paid ? "כן" : "לא"}
      </p>
      <p>
        <strong>נקודה / מקום:</strong> {pay.pointName}
      </p>
    </div>
  );
}

function PointDetailBody({ name }: { name: string }) {
  return (
    <div>
      <p>
        <strong>שם נקודה:</strong> {name}
      </p>
      <p>
        <strong>עיר:</strong> דמו
      </p>
      <p>
        <strong>איש קשר:</strong> דמו · <strong>טלפון:</strong> 03-0000000
      </p>
      <p style={{ color: "var(--adm-muted)", fontSize: "0.88rem" }}>פרטי נקודת מסירה / תשלום — ללא יציאה מהמסך הנוכחי.</p>
    </div>
  );
}

function findOrderByNum(num: string): DemoOrder | undefined {
  return demoOrders.find((o) => o.num === num);
}

function findPaymentById(id: string): DemoPayment | undefined {
  return demoRecentPayments.find((p) => p.id === id);
}

export function OrderIntakeMock() {
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [amountOpen, setAmountOpen] = useState(false);
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [pointOpen, setPointOpen] = useState<string | null>(null);
  const sample = demoOrders[0];

  return (
    <div className="wf-shell">
      <div className="wf-note">
        מסך קליטת הזמנה — נתוני דמו. פתיחת פרטים בשכבה עליונה (מודל / מגירה) ללא ניווט, כמו במערכת הישנה.
      </div>
      <div className="wf-toolbar">
        <span className="wf-badge">שבוע פעיל: AH-118</span>
        <div className="wf-actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled>
            טיוטה
          </button>
          <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" disabled>
            שמירת הזמנה
          </button>
        </div>
      </div>
      <div className="wf-panel">
        <h2>קישורים מהירים (דמו)</h2>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--adm-muted)" }}>
          לחיצה פותחת חלון — הטופס נשאר ברקע.
        </p>
        <div className="wf-actions" style={{ marginTop: 0 }}>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setCustomerCode(sample.custCode)}>
            כרטסת לקוח ({sample.custCode})
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setAmountOpen(true)}>
            פירוט סכום
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setOrder(sample)}>
            פרטי הזמנה ({sample.num})
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setPointOpen(sample.pointName)}>
            נקודת מסירה
          </button>
        </div>
      </div>
      <div className="wf-grid2">
        <div className="wf-panel">
          <h2>פרטי לקוח ושבוע</h2>
          <div className="wf-field">
            <label>חיפוש לקוח (שם / קוד)</label>
            <input placeholder="לדוגמה: לקוח דמו א׳" disabled />
          </div>
          <div className="wf-field">
            <label>קוד שבוע עבודה</label>
            <input defaultValue="AH-118" disabled />
          </div>
        </div>
        <div className="wf-panel">
          <h2>סכומים ומטבע</h2>
          <div className="wf-field">
            <label>סכום בשקלים</label>
            <button type="button" className="wf-cell-btn wf-cell-btn--muted" onClick={() => setAmountOpen(true)}>
              ₪ {sample.ils}
            </button>
          </div>
          <div className="wf-field">
            <label>סכום בדולרים</label>
            <button type="button" className="wf-cell-btn wf-cell-btn--muted" onClick={() => setAmountOpen(true)}>
              $ {sample.usd}
            </button>
          </div>
        </div>
      </div>

      <Modal open={!!customerCode} onClose={() => setCustomerCode(null)} title="כרטסת לקוח" size="md">
        {customerCode ? <CustomerCardBody code={customerCode} /> : null}
      </Modal>
      <Modal open={amountOpen} onClose={() => setAmountOpen(false)} title="פירוט סכום" size="sm">
        <AmountBreakdownBody title="פירוט לפני שמירה (דמו)" ils={`₪ ${sample.ils}`} usd={`$ ${sample.usd}`} />
      </Modal>
      <Drawer open={!!order} onClose={() => setOrder(null)} title="פרטי הזמנה">
        {order ? <OrderDetailBody order={order} /> : null}
      </Drawer>
      <Drawer open={!!pointOpen} onClose={() => setPointOpen(null)} title="פרטי נקודה">
        {pointOpen ? <PointDetailBody name={pointOpen} /> : null}
      </Drawer>
    </div>
  );
}

export function OrderListMock() {
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [pointOpen, setPointOpen] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [amount, setAmount] = useState<{ title: string; ils: string; usd: string } | null>(null);

  return (
    <div className="wf-shell">
      <div className="wf-note">רשימת הזמנות — לחיצה על מספר הזמנה פותחת מגירה; על קוד לקוח או סכום — מודל.</div>
      <div className="wf-toolbar">
        <input placeholder="חיפוש: מספר הזמנה, לקוח, שבוע…" disabled style={{ maxWidth: "360px", padding: "0.5rem 0.75rem", borderRadius: "10px", border: "1px solid var(--adm-border)" }} />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled>
          סינון שבוע
        </button>
      </div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>מספר הזמנה</th>
              <th>לקוח</th>
              <th>קוד</th>
              <th>שבוע</th>
              <th>דולר</th>
              <th>נקודה</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {demoOrders.map((r) => (
              <tr key={r.num} className="wf-row-action" onClick={() => setOrder(r)} title="לחיצה על השורה — פרטי הזמנה">
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setOrder(r))}>
                    {r.num}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setCustomerCode(r.custCode))}>
                    {r.cust}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={(e) => (e.stopPropagation(), setCustomerCode(r.custCode))}
                  >
                    {r.custCode}
                  </button>
                </td>
                <td>{r.week}</td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={(e) =>
                      (e.stopPropagation(),
                      setAmount({
                        title: `פירוט סכום להזמנה ${r.num}`,
                        ils: `₪ ${r.ils}`,
                        usd: `$ ${r.usd}`,
                      }))
                    }
                  >
                    ${r.usd}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setPointOpen(r.pointName))}>
                    {r.pointName}
                  </button>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span className="adm-badge adm-badge--ok">{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={!!order} onClose={() => setOrder(null)} title="פרטי הזמנה">
        {order ? <OrderDetailBody order={order} /> : null}
      </Drawer>
      <Drawer open={!!pointOpen} onClose={() => setPointOpen(null)} title="פרטי נקודה">
        {pointOpen ? <PointDetailBody name={pointOpen} /> : null}
      </Drawer>
      <Modal open={!!customerCode} onClose={() => setCustomerCode(null)} title="כרטסת לקוח">
        {customerCode ? <CustomerCardBody code={customerCode} /> : null}
      </Modal>
      <Modal open={!!amount} onClose={() => setAmount(null)} title="פירוט סכום" size="sm">
        {amount ? <AmountBreakdownBody title={amount.title} ils={amount.ils} usd={amount.usd} /> : null}
      </Modal>
    </div>
  );
}

export function PaymentIntakeMock() {
  const [pay, setPay] = useState<DemoPayment | null>(null);
  const [orderNum, setOrderNum] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [amountDetail, setAmountDetail] = useState<{ title: string; ils: string; usd: string } | null>(null);
  const [pointOpen, setPointOpen] = useState<string | null>(null);
  const order = orderNum ? findOrderByNum(orderNum) : null;

  function closeAmount() {
    setAmountDetail(null);
  }

  return (
    <div className="wf-shell">
      <div className="wf-note">קליטת תשלום — טבלת תשלומים אחרונים: לחיצה על שורה פותחת מגירת פרטים.</div>
      <div className="wf-split">
        <div className="wf-panel">
          <h2>פרטי תשלום</h2>
          <div className="wf-field">
            <label>לקוח</label>
            <button type="button" className="wf-cell-btn wf-cell-btn--muted" onClick={() => setCustomerCode("C-1001")}>
              לקוח דמו א׳ (C-1001)
            </button>
          </div>
          <div className="wf-field">
            <label>הזמנה (אופציונלי)</label>
            <button type="button" className="wf-cell-btn" onClick={() => setOrderNum("AH-118-0142")}>
              AH-118-0142
            </button>
          </div>
          <div className="wf-grid2">
            <div className="wf-field">
              <label>סכום בשקלים</label>
              <button
                type="button"
                className="wf-cell-btn wf-cell-btn--muted"
                onClick={() => setAmountDetail({ title: "פירוט תשלום (טופס)", ils: "₪ 4,520", usd: "$ 1,240" })}
              >
                ₪ 4,520
              </button>
            </div>
            <div className="wf-field">
              <label>נקודת תשלום</label>
              <button type="button" className="wf-cell-btn" onClick={() => setPointOpen("נקודת דמו — חולון")}>
                נקודת דמו — חולון
              </button>
            </div>
          </div>
          <div className="wf-actions">
            <button type="button" className="adm-btn adm-btn--primary" disabled>
              רישום תשלום
            </button>
          </div>
        </div>
        <div className="wf-panel">
          <h2>סיכום מהיר</h2>
          <div className="wf-kpi">
            <div>
              <span>יתרה צפויה (דמו)</span>
              <button
                type="button"
                className="wf-cell-btn wf-cell-btn--muted"
                style={{ fontSize: "1.05rem" }}
                onClick={() => setAmountDetail({ title: "יתרה צפויה", ils: "₪ 4,520", usd: "$ 1,240" })}
              >
                ₪ 4,520
              </button>
            </div>
            <div>
              <span>שער</span>
              <strong>3.65</strong>
            </div>
          </div>
        </div>
      </div>

      <h3 style={{ margin: "0.5rem 0 0.35rem", fontSize: "0.95rem" }}>תשלומים אחרונים (דמו)</h3>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>מזהה</th>
              <th>לקוח</th>
              <th>הזמנה</th>
              <th>סכום</th>
              <th>נקודה</th>
            </tr>
          </thead>
          <tbody>
            {demoRecentPayments.map((p) => (
              <tr key={p.id} className="wf-row-action" onClick={() => setPay(p)}>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setPay(p))}>
                    {p.id}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setCustomerCode(p.custCode))}>
                    {p.cust}
                  </button>
                </td>
                <td>
                  {p.order ? (
                    <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setOrderNum(p.order!))}>
                      {p.order}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={(e) =>
                      (e.stopPropagation(),
                      setAmountDetail({
                        title: `פירוט תשלום ${p.id}`,
                        ils: `₪ ${p.ils}`,
                        usd: `$ ${p.usd}`,
                      }))
                    }
                  >
                    ₪ {p.ils}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setPointOpen(p.pointName))}>
                    {p.pointName}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={!!pay} onClose={() => setPay(null)} title="פרטי תשלום">
        {pay ? <PaymentDetailBody pay={pay} /> : null}
      </Drawer>
      <Drawer open={!!order} onClose={() => setOrderNum(null)} title="פרטי הזמנה">
        {order ? <OrderDetailBody order={order} /> : null}
      </Drawer>
      <Modal open={!!customerCode} onClose={() => setCustomerCode(null)} title="כרטסת לקוח">
        {customerCode ? <CustomerCardBody code={customerCode} /> : null}
      </Modal>
      <Modal open={!!amountDetail} onClose={closeAmount} title="פירוט סכום" size="sm">
        {amountDetail ? <AmountBreakdownBody title={amountDetail.title} ils={amountDetail.ils} usd={amountDetail.usd} /> : null}
      </Modal>
      <Drawer open={!!pointOpen} onClose={() => setPointOpen(null)} title="פרטי נקודה">
        {pointOpen ? <PointDetailBody name={pointOpen} /> : null}
      </Drawer>
    </div>
  );
}

export function ReceiptControlMock() {
  const [cell, setCell] = useState<{ title: string; ils: string; usd: string } | null>(null);
  return (
    <div className="wf-shell">
      <div className="wf-note">בקרת תקבולים — לחיצה על סכום פותחת מודל פירוט.</div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>שבוע</th>
              <th>צפי בשקלים</th>
              <th>התקבל</th>
              <th>הפרש</th>
              <th>הערה</th>
            </tr>
          </thead>
          <tbody>
            {demoReceipt.map((r) => (
              <tr key={r.week}>
                <td style={{ fontWeight: 700 }}>{r.week}</td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setCell({ title: `פירוט צפי ${r.week}`, ils: r.expected, usd: "—" })}>
                    {r.expected}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setCell({ title: `פירוט התקבל ${r.week}`, ils: r.received, usd: "—" })}>
                    {r.received}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setCell({ title: `ניתוח הפרש ${r.week}`, ils: r.diff, usd: "—" })}>
                    {r.diff}
                  </button>
                </td>
                <td style={{ color: "var(--adm-muted)" }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!cell} onClose={() => setCell(null)} title="פירוט סכום" size="sm">
        {cell ? <AmountBreakdownBody title={cell.title} ils={cell.ils} usd={cell.usd} /> : null}
      </Modal>
    </div>
  );
}

export function CustomerLedgerMock() {
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [pay, setPay] = useState<DemoPayment | null>(null);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [amount, setAmount] = useState<{ title: string; ils: string; usd: string } | null>(null);

  function onRefClick(ref: string) {
    const m = ref.match(/AH-[\d-]+/);
    if (m) {
      const o = findOrderByNum(m[0]);
      if (o) setOrder(o);
      return;
    }
    const p = ref.match(/P-\d+/);
    if (p) {
      const payRow = findPaymentById(p[0]);
      if (payRow) setPay(payRow);
    }
  }

  return (
    <div className="wf-shell">
      <div className="wf-note">כרטסת לקוח — לחיצה על אסמכתא (הזמנה / תשלום) פותחת מגירה; על סכומים — פירוט.</div>
      <div className="wf-toolbar">
        <div>
          <strong style={{ fontSize: "1.1rem" }}>לקוח דמו א׳</strong>
          <div style={{ fontSize: "0.85rem", color: "var(--adm-muted)" }}>
            קוד לקוח:{" "}
            <button type="button" className="wf-cell-btn" onClick={() => setCustomerCode("C-1001")}>
              C-1001
            </button>{" "}
            · שבוע AH-118
          </div>
        </div>
        <span className="wf-badge">יתרה: ₪ 12,400</span>
      </div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>אסמכתא</th>
              <th>חובה</th>
              <th>זכות</th>
              <th>יתרה</th>
            </tr>
          </thead>
          <tbody>
            {demoLedger.map((r, i) => (
              <tr key={i}>
                <td>{r.date}</td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => onRefClick(r.ref)}>
                    {r.ref}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={() => setAmount({ title: `חובה · ${r.ref}`, ils: r.debit, usd: "—" })}
                  >
                    {r.debit}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={() => setAmount({ title: `זכות · ${r.ref}`, ils: r.credit, usd: "—" })}
                  >
                    {r.credit}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setAmount({ title: "יתרה מצטברת", ils: r.bal, usd: "—" })}>
                    {r.bal}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={!!order} onClose={() => setOrder(null)} title="פרטי הזמנה">
        {order ? <OrderDetailBody order={order} /> : null}
      </Drawer>
      <Drawer open={!!pay} onClose={() => setPay(null)} title="פרטי תשלום">
        {pay ? <PaymentDetailBody pay={pay} /> : null}
      </Drawer>
      <Modal open={!!customerCode} onClose={() => setCustomerCode(null)} title="כרטסת לקוח">
        {customerCode ? <CustomerCardBody code={customerCode} /> : null}
      </Modal>
      <Modal open={!!amount} onClose={() => setAmount(null)} title="פירוט סכום" size="sm">
        {amount ? <AmountBreakdownBody title={amount.title} ils={amount.ils} usd={amount.usd} /> : null}
      </Modal>
    </div>
  );
}

export function BalancesMock() {
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [amount, setAmount] = useState<{ title: string; ils: string; usd: string } | null>(null);

  return (
    <div className="wf-shell">
      <div className="wf-note">יתרות — קוד לקוח פותח כרטסת מודל; יתרה בשקלים — פירוט מודל.</div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>לקוח</th>
              <th>קוד</th>
              <th>יתרה בשקלים</th>
              <th>יתרה בדולר</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {demoBalances.map((r) => (
              <tr key={r.code}>
                <td style={{ fontWeight: 600 }}>{r.cust}</td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setCustomerCode(r.code)}>
                    {r.code}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="wf-cell-btn"
                    onClick={() => setAmount({ title: `יתרה · ${r.cust}`, ils: r.ils, usd: r.usd })}
                  >
                    {r.ils}
                  </button>
                </td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={() => setAmount({ title: `דולר · ${r.cust}`, ils: "—", usd: r.usd })}>
                    {r.usd}
                  </button>
                </td>
                <td>
                  <span className={r.risk === "תקין" ? "adm-badge adm-badge--ok" : "adm-badge adm-badge--off"}>{r.risk}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!customerCode} onClose={() => setCustomerCode(null)} title="כרטסת לקוח">
        {customerCode ? <CustomerCardBody code={customerCode} /> : null}
      </Modal>
      <Modal open={!!amount} onClose={() => setAmount(null)} title="פירוט סכום" size="sm">
        {amount ? <AmountBreakdownBody title={amount.title} ils={amount.ils} usd={amount.usd} /> : null}
      </Modal>
    </div>
  );
}

export function SourceTablesMock() {
  const [rawModal, setRawModal] = useState<{ table: string; legacyId: string } | null>(null);
  return (
    <div className="wf-shell">
      <div className="wf-note">טבלאות מקור — לחיצה על שורה: פרטי שורה גולמית במודל.</div>
      <div className="wf-toolbar">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled>
          ייבוא שורה לדוגמה
        </button>
      </div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>שם טבלה ישנה</th>
              <th>מזהה רשומה</th>
              <th>תאריך ייבוא</th>
            </tr>
          </thead>
          <tbody>
            {demoRaw.map((r, i) => (
              <tr key={i} className="wf-row-action" onClick={() => setRawModal({ table: r.table, legacyId: r.legacyId })}>
                <td>{r.table}</td>
                <td>
                  <button type="button" className="wf-cell-btn" onClick={(e) => (e.stopPropagation(), setRawModal({ table: r.table, legacyId: r.legacyId }))}>
                    {r.legacyId}
                  </button>
                </td>
                <td>{r.imported}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!rawModal} onClose={() => setRawModal(null)} title="שורה גולמית" size="md">
        {rawModal ? (
          <div>
            <p>
              <strong>טבלה:</strong> {rawModal.table}
            </p>
            <p>
              <strong>מזהה ישן:</strong> {rawModal.legacyId}
            </p>
            <p style={{ color: "var(--adm-muted)", fontSize: "0.88rem" }}>תצוגת JSON מלאה תתווסף בשלב המיגרציה.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function ExcelImportMock() {
  return (
    <div className="wf-shell">
      <div className="wf-note">ייבוא Excel — בחירת קובץ, התאמת עמודות ותצוגה מקדימה יתווספו בשלב הבא.</div>
      <div className="wf-panel">
        <h2>קליטת קובץ</h2>
        <div className="wf-field">
          <label>קובץ</label>
          <input type="file" disabled />
        </div>
        <div className="wf-actions">
          <button type="button" className="adm-btn adm-btn--primary" disabled>
            המשך לבדיקה
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReportsMock() {
  return (
    <div className="wf-shell">
      <div className="wf-note">דוחות תפעוליים וכספיים — תבניות דוח יוגדרו לפי דרישות העסק.</div>
      <div className="wf-grid2">
        {["סיכום שבועי", "תשלומים לפי נקודה", "הזמנות פתוחות"].map((t) => (
          <div key={t} className="wf-panel">
            <h2 style={{ marginBottom: "0.5rem" }}>{t}</h2>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--adm-muted)" }}>תצוגה מקדימה תתווסף כאן.</p>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" style={{ marginTop: "0.75rem" }} disabled>
              הפקת דוח
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityLogMock() {
  return (
    <div className="wf-shell">
      <div className="wf-note">יומן פעילות — יחובר ל-AuditLog בעתיד.</div>
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              <th>זמן</th>
              <th>משתמש</th>
              <th>פעולה</th>
              <th>פרטים</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>היום 09:12</td>
              <td>מנהל מערכת</td>
              <td>כניסה למערכת</td>
              <td style={{ color: "var(--adm-muted)" }}>דמו</td>
            </tr>
            <tr>
              <td>אתמול 16:40</td>
              <td>עובד דמו</td>
              <td>צפייה ברשימת הזמנות</td>
              <td style={{ color: "var(--adm-muted)" }}>דמו</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SettingsMock() {
  return (
    <div className="wf-shell">
      <div className="wf-note">הגדרות מערכת — שערים, מסמכים ופרמטרים יוגדרו כאן.</div>
      <div className="wf-panel">
        <h2>פרמטרים כלליים</h2>
        <div className="wf-field">
          <label>שער דולר ברירת מחדל (הצגה)</label>
          <input defaultValue="3.65" disabled />
        </div>
        <div className="wf-field">
          <label>קידוד שבוע עבודה נוכחי</label>
          <input defaultValue="AH-118" disabled />
        </div>
      </div>
    </div>
  );
}
