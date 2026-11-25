import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Field, SelectField } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { formatPrice } from "@/lib/money";
import { requirePermission } from "@/modules/auth/access";
import { approveMany } from "@/modules/orders/actions";
import {
  deliveryMethods,
  flagLabels,
  formatDate,
  orderStatuses,
  paymentMethods,
  paymentStatuses,
  type OrderStatus,
} from "@/modules/orders/labels";
import { listOrders } from "@/modules/orders/queries";

export const metadata: Metadata = { title: "Siparişler" };

const statuses = Object.keys(orderStatuses) as OrderStatus[];
const filterSchema = z.object({
  ara: z.string().max(100).catch(""),
  durum: z.enum(["", "refund", ...statuses]).catch(""),
  sayfa: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function OrdersPage({
  searchParams,
}: PageProps<"/yonetim/siparisler">) {
  const { permissions } = await requirePermission("orders.read");
  const { ara, durum, sayfa } = filterSchema.parse(await searchParams);
  const { rows, hasNext } = await listOrders({
    status: durum,
    query: ara,
    page: sayfa,
  });
  const pageLink = (page: number) =>
    `?${new URLSearchParams({ ara, durum, sayfa: String(page) })}`;

  // Uyarısı olan sipariş toplu onaya girmez; tek tek incelenir.
  const bulk =
    durum === "awaiting_approval" && permissions.includes("orders.approve");
  const list = (
    <ul className="divide-y divide-gri/40 border-y border-gri/40">
      {rows.map((o) => (
        <li key={o.id} aria-label={o.order_no} className="flex gap-3 py-3">
          {bulk && o.flags.length === 0 && (
            <label className="flex size-11 shrink-0 items-center justify-center">
              <span className="sr-only">Seç: {o.order_no}</span>
              <input
                type="checkbox"
                name="ids"
                value={o.id}
                className="size-5 accent-petrol"
              />
            </label>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <Link
                href={`/yonetim/siparisler/${o.id}`}
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
              >
                {o.order_no}
              </Link>
              <span className="font-bold">{formatPrice(o.total)}</span>
            </div>
            <p className="break-words">
              {o.contact_name} · {formatDate(o.created_at)}
            </p>
            <p className="text-sm text-gri">
              {orderStatuses[o.order_status]} ·{" "}
              {paymentStatuses[o.payment_status]} ·{" "}
              {paymentMethods[o.payment_method]} ·{" "}
              {deliveryMethods[o.delivery_method]}
            </p>
            {o.flags.map((f) => (
              <p key={f} className="text-sm font-semibold text-nar">
                {flagLabels[f] ?? f}
              </p>
            ))}
            {o.overdue && (
              <p className="text-sm font-semibold text-nar">
                Teslim alma süresi doldu
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Siparişler</h1>

      <form className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field
          label="Sipariş no, ad, telefon veya e-posta"
          name="ara"
          type="search"
          defaultValue={ara}
          maxLength={100}
        />
        <SelectField
          label="Durum"
          name="durum"
          empty="Hepsi"
          options={[
            ...statuses.map((value) => ({
              value: value as string,
              label: orderStatuses[value] as string,
            })),
            { value: "refund", label: "Para iadesi bekleyen" },
          ]}
          defaultValue={durum}
        />
        <button className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane">
          Ara
        </button>
      </form>

      {rows.length === 0 && <p>Sipariş bulunamadı.</p>}
      {bulk && rows.length > 0 ? (
        <PanelForm
          action={approveMany}
          submit="Seçilenleri onayla"
          confirm="Seçilen siparişler onaylansın mı? Stok düşülecek."
        >
          {list}
        </PanelForm>
      ) : (
        list
      )}

      <nav aria-label="Sayfalar" className="flex justify-between">
        {sayfa > 1 ? (
          <Link href={pageLink(sayfa - 1)} className="underline">
            Önceki
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link href={pageLink(sayfa + 1)} className="underline">
            Sonraki
          </Link>
        )}
      </nav>
    </div>
  );
}
