import {
  BadgeDollarSign,
  CreditCard,
  IdCard,
  Landmark,
  MapPin,
  Package,
  Receipt,
  Scale,
  Tags,
  Users,
} from "lucide-react";
import type React from "react";
import type { SourceTableIconKey } from "@/lib/source-table-definitions";

const ICONS = {
  users: Users,
  package: Package,
  scale: Scale,
  dollar: BadgeDollarSign,
  receipt: Receipt,
  "credit-card": CreditCard,
  "id-card": IdCard,
  tag: Tags,
  "map-pin": MapPin,
  landmark: Landmark,
} satisfies Record<SourceTableIconKey, React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>>;

export function SourceTableIcon({ icon }: { icon: SourceTableIconKey }) {
  const Icon = ICONS[icon];
  return <Icon size={18} strokeWidth={1.75} aria-hidden />;
}
