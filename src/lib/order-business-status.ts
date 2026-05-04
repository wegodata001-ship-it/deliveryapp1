/** תצוגת סטטוס הזמנה בטבלה/דפים עסקיים (צבעים) */
export function orderBusinessStatusDisplay(status: string): { label: string; className: string } {
  switch (status) {
    case "OPEN":
      return { label: "פתוחה", className: "adm-ord-st adm-ord-st--open" };
    case "WAITING_FOR_EXECUTION":
    case "SENT":
    case "WAITING_FOR_CHINA_EXECUTION":
    case "WITHDRAWAL_FROM_SUPPLIER":
      return { label: "בטיפול", className: "adm-ord-st adm-ord-st--progress" };
    case "COMPLETED":
      return { label: "הושלמה", className: "adm-ord-st adm-ord-st--done" };
    case "CANCELLED":
      return { label: "מבוטלת", className: "adm-ord-st adm-ord-st--muted" };
    default:
      return { label: status, className: "adm-ord-st adm-ord-st--muted" };
  }
}
