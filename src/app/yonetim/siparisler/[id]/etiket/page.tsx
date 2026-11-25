import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/modules/account/validation";
import { requirePermission } from "@/modules/auth/access";
import { getOrderDetail } from "@/modules/orders/queries";
import { PrintButton } from "@/modules/shipping/print-button";

export const metadata: Metadata = { title: "Kargo etiketi" };

/** Firma bağlantısı kurulana kadar paketin üstüne yapıştırılan A6 adres etiketi. */
export default async function LabelPage({
  params,
}: PageProps<"/yonetim/siparisler/[id]/etiket">) {
  await requirePermission("shipping.write");
  const { id } = await params;
  const o = await getOrderDetail(id);
  const to = o?.addresses.delivery;
  if (!o?.shipment || !to) notFound();

  return (
    <div className="space-y-4">
      <h1 className="font-baslik text-3xl font-bold print:hidden">
        Kargo etiketi
      </h1>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <section
        aria-label="Etiket"
        className="etiket w-full max-w-[95mm] space-y-3 border-2 border-black bg-white p-4 break-words text-black"
      >
        <p className="text-sm">Gönderen: Aliş Bebe, Eskişehir</p>
        <div>
          <p className="text-sm">Alıcı</p>
          <p className="text-xl font-bold">{to.recipient}</p>
          <p>{formatPhone(to.phone)}</p>
          <p>{to.line}</p>
          <p className="text-lg font-bold">
            {to.district} / {to.city} {to.postal_code}
          </p>
        </div>
        {o.payment_method === "cod" && (
          <p className="border-2 border-black p-2 text-lg font-bold">
            Kapıda ödeme: {formatPrice(o.total)}
          </p>
        )}
        <div className="border-t-2 border-black pt-2">
          <p>
            Gönderi: <strong>{o.shipment.our_ref}</strong>
          </p>
          {o.shipment.tracking_no && (
            <p>
              {o.shipment.carrier}: <strong>{o.shipment.tracking_no}</strong>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
