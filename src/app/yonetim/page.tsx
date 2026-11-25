import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/modules/auth/access";
import { getOrderSummary } from "@/modules/orders/queries";
import { getStockSummary } from "@/modules/stock/queries";

export const metadata: Metadata = { title: "Yönetim" };

export default async function AdminPage() {
  const access = await requirePermission("dashboard.read");
  const can = (permission: string) => access.permissions.includes(permission);
  const [orders, stock] = await Promise.all([
    can("orders.read") ? getOrderSummary() : null,
    can("stock.read") ? getStockSummary() : null,
  ]);

  const cards: { label: string; value: number; href: string }[] = [];
  if (orders) {
    const list = "/yonetim/siparisler?durum=";
    cards.push(
      {
        label: "Onay bekleyen",
        value: orders.awaiting,
        href: `${list}awaiting_approval`,
      },
      {
        label: "Tutarı incelenen",
        value: orders.review,
        href: `${list}pending_payment`,
      },
      {
        label: "Para iadesi bekleyen",
        value: orders.refund,
        href: `${list}refund`,
      },
      {
        label: "Teslim süresi dolan",
        value: orders.overdue,
        href: `${list}ready_for_pickup`,
      },
      {
        label: "Kargodan para beklenen",
        value: orders.cod,
        href: `${list}cod`,
      },
    );
  }
  if (stock) {
    cards.push(
      {
        label: "Kritik stok",
        value: stock.critical,
        href: "/yonetim/stok?durum=critical",
      },
      {
        label: "Tükenen",
        value: stock.out_of_stock,
        href: "/yonetim/stok?durum=out",
      },
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-baslik text-3xl font-bold">Yönetim paneli</h1>
      <p className="break-words">
        {access.email} · {access.permissions.length} izin
      </p>
      {cards.length > 0 && (
        <ul className="grid grid-cols-2 gap-4">
          {cards.map((card) => (
            <li key={card.label}>
              <Link
                href={card.href}
                className="block h-full rounded-xl bg-white p-4 hover:bg-nane"
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
