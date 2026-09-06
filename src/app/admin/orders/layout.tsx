import { Suspense } from "react";

/**
 * גבול Suspense מקומי — מונע מ-admin/loading.tsx להחליף את כל העמוד
 * ב-GlobalLoader (מסך קפוא) כשמשנים ?ordersWeek=.
 * startTransition ב-replace משאיר את העמוד הקודם גלוי ברוב המקרים.
 */
export default function OrdersSegmentLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
