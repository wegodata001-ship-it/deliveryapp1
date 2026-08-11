"use client";

import { useEffect, useRef, useState } from "react";
import type { CreateShipmentRecordInput } from "@/app/admin/shipments/types";

export type QuickAddPackageForm = {
  customerCode: string;
  customerName: string;
  city: string;
  boxes: string;
  weight: string;
  deliveryFeeAmount: string;
};

const EMPTY_FORM: QuickAddPackageForm = {
  customerCode: "",
  customerName: "",
  city: "",
  boxes: "1",
  weight: "",
  deliveryFeeAmount: "",
};

type Props = {
  batchLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (input: Omit<CreateShipmentRecordInput, "batchId">, addAnother: boolean) => Promise<boolean>;
};

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function QuickAddPackagePanel({ batchLabel, busy = false, onCancel, onSave }: Props) {
  const [form, setForm] = useState<QuickAddPackageForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  function patch<K extends keyof QuickAddPackageForm>(key: K, value: QuickAddPackageForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildInput(): Omit<CreateShipmentRecordInput, "batchId"> {
    const customerName = form.customerName.trim();
    if (!customerName) throw new Error("שם לקוח חובה");
    const boxes = parseOptionalNumber(form.boxes);
    if (form.boxes.trim() && boxes == null) throw new Error("מספר קרטונים לא תקין");
    const weight = parseOptionalNumber(form.weight);
    if (form.weight.trim() && weight == null) throw new Error("משקל לא תקין");
    const deliveryFeeAmount = parseOptionalNumber(form.deliveryFeeAmount);
    if (form.deliveryFeeAmount.trim() && deliveryFeeAmount == null) {
      throw new Error("דמי משלוח לא תקינים");
    }
    return {
      customerCode: form.customerCode.trim() || null,
      customerName,
      city: form.city.trim() || null,
      boxes: boxes ?? 1,
      weight,
      deliveryFeeAmount,
      deliveryFeeCurrency: "ILS",
    };
  }

  async function handleSave(addAnother: boolean) {
    setError(null);
    try {
      const input = buildInput();
      const ok = await onSave(input, addAnother);
      if (ok) {
        if (addAnother) {
          setForm({ ...EMPTY_FORM, boxes: "1" });
          window.setTimeout(() => nameRef.current?.focus(), 0);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const locked = busy;

  return (
    <div
      className="shp-quick-add"
      dir="rtl"
      style={{
        border: "1px solid #bfdbfe",
        borderRadius: 10,
        background: "#f8fbff",
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <strong style={{ fontSize: 14 }}>הוספת חבילה חדשה</strong>
        <span style={{ fontSize: 12, color: "#64748b" }}>משלוח {batchLabel}</span>
      </div>

      <div
        className="shp-quick-add__grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>קוד לקוח</span>
          <input
            value={form.customerCode}
            disabled={locked}
            onChange={(e) => patch("customerCode", e.target.value)}
            placeholder="אופציונלי"
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>שם לקוח *</span>
          <input
            ref={nameRef}
            value={form.customerName}
            disabled={locked}
            onChange={(e) => patch("customerName", e.target.value)}
            placeholder="שם הלקוח"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave(false);
              }
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>מקום מסירה</span>
          <input
            value={form.city}
            disabled={locked}
            onChange={(e) => patch("city", e.target.value)}
            placeholder="יישוב / כתובת"
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>קרטונים</span>
          <input
            inputMode="numeric"
            value={form.boxes}
            disabled={locked}
            onChange={(e) => patch("boxes", e.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>משקל</span>
          <input
            inputMode="decimal"
            value={form.weight}
            disabled={locked}
            onChange={(e) => patch("weight", e.target.value)}
            placeholder="ק״ג"
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <span>דמי משלוח ₪</span>
          <input
            inputMode="decimal"
            value={form.deliveryFeeAmount}
            disabled={locked}
            onChange={(e) => patch("deliveryFeeAmount", e.target.value)}
          />
        </label>
      </div>

      {error ? (
        <div className="shp-alert shp-alert--error" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 12,
          justifyContent: "flex-start",
        }}
      >
        <button
          type="button"
          className="shp-btn shp-btn--primary shp-btn--sm"
          disabled={locked}
          onClick={() => void handleSave(false)}
        >
          {locked ? "שומר…" : "שמור"}
        </button>
        <button
          type="button"
          className="shp-btn shp-btn--secondary shp-btn--sm"
          disabled={locked}
          onClick={() => void handleSave(true)}
        >
          שמור + הוסף עוד
        </button>
        <button type="button" className="shp-btn shp-btn--sm" disabled={locked} onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

export { EMPTY_FORM as QUICK_ADD_PACKAGE_EMPTY_FORM };
