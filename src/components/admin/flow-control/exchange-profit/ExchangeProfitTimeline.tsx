"use client";

import type { ExchangeProfitTimelineEvent } from "@/app/admin/cash-flow/exchange-profit-types";

const KIND_CLASS: Record<ExchangeProfitTimelineEvent["kind"], string> = {
  order_opened: "open",
  customer_paid: "paid",
  fx_conversion: "fx",
  supplier_paid: "supplier",
  order_closed: "closed",
};

export function ExchangeProfitTimeline({ events }: { events: ExchangeProfitTimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="xp-muted">אין אירועים בלוח הזמנים.</p>;
  }

  return (
    <ol className="xp-timeline">
      {events.map((ev, idx) => (
        <li key={ev.id} className={`xp-timeline__item xp-timeline__item--${KIND_CLASS[ev.kind]}`}>
          <div className="xp-timeline__dot" aria-hidden />
          {idx < events.length - 1 ? <div className="xp-timeline__line" aria-hidden /> : null}
          <div className="xp-timeline__body">
            <div className="xp-timeline__when">
              <span dir="ltr">{ev.dateLabel}</span>
              <span dir="ltr">{ev.timeLabel}</span>
            </div>
            <strong className="xp-timeline__title">{ev.title}</strong>
            {ev.detail ? (
              <p className="xp-timeline__detail" dir="ltr">
                {ev.detail}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default ExchangeProfitTimeline;
