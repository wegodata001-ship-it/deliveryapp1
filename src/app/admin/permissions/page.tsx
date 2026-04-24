import { redirect } from "next/navigation";

/** ניהול הרשאות מתבצע רק מתוך טופס עובד */
export default function LegacyPermissionsRedirectPage() {
  redirect("/admin/users");
}
