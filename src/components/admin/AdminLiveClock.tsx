"use client";

import { useEffect, useState } from "react";

function formatClockParts(d: Date) {
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
    day: d.toLocaleDateString("he-IL", { weekday: "long" }),
  };
}

/** תאריך, שעה ויום בעברית — מתעדכן כל דקה (header) */
export function AdminLiveClock({ className }: { className?: string }) {
  const [parts, setParts] = useState(() => formatClockParts(new Date()));

  useEffect(() => {
    const tick = () => setParts(formatClockParts(new Date()));
    tick();
    const intervalId = window.setInterval(tick, 60_000);
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const alignId = window.setTimeout(() => tick(), msToNextMinute);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(alignId);
    };
  }, []);

  return (
    <div
      className={className ? `adm-live-clock ${className}` : "adm-live-clock"}
      aria-live="polite"
      aria-label="תאריך ושעה"
    >
      <span className="adm-live-clock__date">{parts.date}</span>
      <span className="adm-live-clock__time">{parts.time}</span>
      <span className="adm-live-clock__day">{parts.day}</span>
    </div>
  );
}
