import { Suspense } from "react";

/** מונע מ-admin/loading.tsx להקפיא את מסך היתרות בהחלפת שבוע. */
export default function BalancesSegmentLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
