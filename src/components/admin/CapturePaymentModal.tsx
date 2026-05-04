"use client";

import { Modal } from "@/components/ui/Modal";
import { PaymentModal } from "@/components/admin/PaymentModal";
import type { SerializedFinancial } from "@/lib/financial-settings";

type Props = {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  financial?: SerializedFinancial | null;
};

export function CapturePaymentModal({ open, onClose, onToast, financial = null }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="קליטת תשלום" size="xl">
      {open ? (
        <PaymentModal financial={financial} onClose={onClose} onToast={onToast} />
      ) : null}
    </Modal>
  );
}
