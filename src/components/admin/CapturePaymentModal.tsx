"use client";

import { Modal } from "@/components/ui/Modal";
import { PaymentModalUpdated } from "@/components/admin/PaymentModalUpdated";
import type { SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  financial?: SerializedFinancial | null;
};

/**
 * Thin wrapper kept for compatibility with any legacy import paths.
 * The system is unified around the updated payment screen — this modal now
 * renders {@link PaymentModalUpdated} exclusively.
 */
export function CapturePaymentModal({ open, onClose, onToast, financial = null }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="קליטת תשלום" size="xl">
      {open ? (
        <PaymentModalUpdated financial={financial} onToast={onToast} />
      ) : null}
    </Modal>
  );
}
