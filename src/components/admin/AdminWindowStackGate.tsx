"use client";

import dynamic from "next/dynamic";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import type { ComponentProps } from "react";

const AdminWindowStack = dynamic(
  () => import("@/components/admin/AdminWindowStack").then((m) => ({ default: m.AdminWindowStack })),
  { ssr: false },
);

type StackProps = ComponentProps<typeof AdminWindowStack>;

/** טוען חלונות מודאליים רק כשיש חלון פתוח — לא מוריד PaymentModal/OrderCreate בכל ניווט. */
export function AdminWindowStackGate(props: StackProps) {
  const { stack } = useAdminWindows();
  if (stack.length === 0) return null;
  return <AdminWindowStack {...props} />;
}
