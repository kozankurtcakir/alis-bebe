import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/modules/auth/access";
import { signOut } from "@/modules/auth/actions";

export const metadata: Metadata = { title: "Yönetim" };

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <Suspense fallback={<p role="status">Yükleniyor…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const access = await requirePermission("dashboard.read");

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Yönetim paneli</h1>
      <p className="break-words">
        {access.email} · {access.permissions.length} izin
      </p>
      <form action={signOut}>
        <button className="min-h-12 underline">Çıkış yap</button>
      </form>
    </div>
  );
}
