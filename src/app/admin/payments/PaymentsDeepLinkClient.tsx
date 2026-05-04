"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

function PaymentsDeepLinkInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { openWindow } = useAdminWindows();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const customerId = sp.get("customerId")?.trim();
    const amountUsd = sp.get("amountUsd")?.trim();
    if (customerId) {
      done.current = true;
      openWindow({
        type: "payments",
        props: {
          customerId,
          customerName: "",
          ...(amountUsd ? { amountUsd } : {}),
        },
      });
    }
    router.replace("/admin");
  }, [router, sp, openWindow]);

  return <p className="adm-muted adm-payments-deeplink-msg">פותח קליטת תשלום…</p>;
}

export function PaymentsDeepLinkClient() {
  return (
    <Suspense fallback={<p className="adm-muted adm-payments-deeplink-msg">טוען…</p>}>
      <PaymentsDeepLinkInner />
    </Suspense>
  );
}
