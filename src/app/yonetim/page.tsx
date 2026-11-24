import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/access";
import { getStockSummary } from "@/modules/stock/queries";

export const metadata: Metadata = { title: "Yönetim" };

export default async function AdminPage() {
  const access = await requirePermission("dashboard.read");
  const stock = access.permissions.includes("stock.read")
    ? await getStockSummary()
    : null;

  return (
    <div className="space-y-4">
      <h1 className="font-baslik text-3xl font-bold">Yönetim paneli</h1>
      <p className="break-words">
        {access.email} · {access.permissions.length} izin
      </p>
      {stock && (
        <ul className="grid grid-cols-2 gap-4">
          {[
            { label: "Kritik stok", value: stock.critical, state: "critical" },
            { label: "Tükenen", value: stock.out_of_stock, state: "out" },
          ].map((card) => (
            <li key={card.state}>
              <Link
                href={`/yonetim/stok?durum=${card.state}`}
                className="block rounded-xl bg-white p-4 hover:bg-nane"
              >
                <span className="text-gri">{card.label}</span>{" "}
                <span className="block text-3xl font-bold">{card.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
