import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { formatPrice } from "@/lib/money";
import { requireUser } from "@/modules/auth/access";
import { formatDate, orderStatuses } from "@/modules/orders/labels";
import { listMyOrders } from "@/modules/orders/queries";

export const instant = false;
export const metadata: Metadata = { title: "Siparişlerim" };

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export default async function MyOrdersPage({
  searchParams,
}: PageProps<"/hesap/siparisler">) {
  await requireUser();
  const page = pageSchema.parse((await searchParams).sayfa);
  const { rows, hasNext } = await listMyOrders(page);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Siparişlerim</h1>
      {rows.length === 0 && <p>Siparişiniz yok.</p>}
      <ul className="space-y-4">
        {rows.map((o) => (
          <li key={o.order_no} className="rounded-2xl bg-white p-4">
            <Link
              href={`/siparis/${o.order_no}`}
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              {o.order_no}
            </Link>
            <p>
              {orderStatuses[o.order_status]} · {o.pieces} ürün ·{" "}
              {formatPrice(o.total)}
            </p>
            <p className="text-sm text-gri">{formatDate(o.created_at)}</p>
          </li>
        ))}
      </ul>
      <nav aria-label="Sayfalar" className="flex justify-between">
        {page > 1 ? (
          <Link href={`?sayfa=${page - 1}`} className="underline">
            Önceki
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link href={`?sayfa=${page + 1}`} className="underline">
            Sonraki
          </Link>
        )}
      </nav>
    </div>
  );
}
