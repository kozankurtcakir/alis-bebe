import Link from "next/link";
import { Suspense } from "react";
import { getAccess } from "@/modules/auth/access";
import { signOut } from "@/modules/auth/actions";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-6">
      <Suspense fallback={null}>
        <AdminNav />
      </Suspense>
      <main>
        <Suspense fallback={<p role="status">Yükleniyor…</p>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}

const links = [
  { href: "/yonetim", label: "Özet", permission: "dashboard.read" },
  { href: "/yonetim/katalog", label: "Ürünler", permission: "catalog.read" },
  {
    href: "/yonetim/katalog/kategoriler",
    label: "Kategoriler",
    permission: "catalog.read",
  },
  {
    href: "/yonetim/katalog/listeler",
    label: "Seçim listeleri",
    permission: "catalog.read",
  },
  { href: "/yonetim/personel", label: "Personel", permission: "staff.manage" },
  {
    href: "/yonetim/islem-gecmisi",
    label: "İşlem geçmişi",
    permission: "audit.read",
  },
];

/** Bağlantıyı gizlemek yalnızca kolaylıktır; her sayfa izni kendisi kontrol eder. */
async function AdminNav() {
  const access = await getAccess();
  if (!access?.isStaff || !access.hasSecondStep) return null;

  return (
    <nav
      aria-label="Yönetim"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-gri pb-3"
    >
      {links
        .filter((l) => access.permissions.includes(l.permission))
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
          >
            {l.label}
          </Link>
        ))}
      <form action={signOut} className="ml-auto">
        <button className="min-h-11 underline">Çıkış yap</button>
      </form>
    </nav>
  );
}
