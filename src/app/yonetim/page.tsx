import type { Metadata } from "next";
import { requirePermission } from "@/modules/auth/access";

export const metadata: Metadata = { title: "Yönetim" };

export default async function AdminPage() {
  const access = await requirePermission("dashboard.read");

  return (
    <div className="space-y-4">
      <h1 className="font-baslik text-3xl font-bold">Yönetim paneli</h1>
      <p className="break-words">
        {access.email} · {access.permissions.length} izin
      </p>
    </div>
  );
}
