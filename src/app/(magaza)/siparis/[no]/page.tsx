import type { Metadata } from "next";
import Link from "next/link";
import { PanelForm } from "@/components/panel-form";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/modules/account/validation";
import { cancelMyOrder } from "@/modules/orders/actions";
import { payOrder } from "@/modules/payments/actions";
import {
  deliveryMethods,
  formatDate,
  orderStatuses,
  paymentMethods,
  paymentStatuses,
} from "@/modules/orders/labels";
import { Fact, ItemList, TestNotice, Totals } from "@/modules/orders/parts";
import { getCheckoutOptions, getOrder } from "@/modules/orders/queries";
import { shipmentStatuses } from "@/modules/shipping/labels";

export const instant = false;
export const metadata: Metadata = {
  title: "Sipariş",
  robots: { index: false },
};

export default async function OrderPage({
  params,
  searchParams,
}: PageProps<"/siparis/[no]">) {
  const { no } = await params;
  const isNew = (await searchParams).yeni === "1";
  const [order, options] = await Promise.all([
    getOrder(no),
    getCheckoutOptions(),
  ]);

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <h1 className="font-baslik text-3xl font-bold">Sipariş açılamadı</h1>
        <p>
          Siparişinizi görmek için hesabınıza giriş yapın veya e-postanızdaki
          bağlantıyı kullanın.
        </p>
        <Link
          href="/giris"
          className="inline-flex min-h-11 items-center underline"
        >
          Giriş yap
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="font-baslik text-3xl font-bold">
        {isNew ? "Siparişiniz alındı" : "Siparişiniz"}
      </h1>
      {options.test_mode && <TestNotice />}
      <dl className="grid gap-4 rounded-2xl bg-nane p-4 sm:grid-cols-2">
        <Fact label="Sipariş numarası" value={order.order_no} />
        <Fact label="Tarih" value={formatDate(order.created_at)} />
        <Fact label="Durum" value={orderStatuses[order.order_status]} />
        <Fact
          label="Ödeme"
          value={
            // Firmanın parayı bize yatırması müşteriyi ilgilendirmez.
            order.payment_method === "cod" && order.order_status === "delivered"
              ? paymentMethods.cod
              : `${paymentMethods[order.payment_method]} · ${paymentStatuses[order.payment_status]}`
          }
        />
      </dl>

      {order.can_pay && (
        <section
          aria-labelledby="kart"
          className="space-y-3 rounded-2xl bg-white p-4"
        >
          <h2 id="kart" className="font-baslik text-xl font-bold">
            Kartla ödeme
          </h2>
          <p>
            {order.payment_status === "failed"
              ? "Kartınız reddedildi. Yeniden deneyebilirsiniz."
              : "Ödemeniz henüz görünmüyor. Ödediyseniz sonuç birkaç dakika içinde burada görünür; yeniden ödemeyin."}
          </p>
          {order.payment_due_at && (
            <p>
              Son ödeme: {formatDate(order.payment_due_at)}. Süre dolarsa
              sipariş kendiliğinden iptal olur.
            </p>
          )}
          <PanelForm
            action={payOrder}
            hidden={{ no: order.order_no }}
            submit={`Kartla öde: ${formatPrice(order.total)}`}
            primary
          />
        </section>
      )}

      {order.bank && (
        <section
          aria-labelledby="havale"
          className="space-y-2 rounded-2xl bg-white p-4"
        >
          <h2 id="havale" className="font-baslik text-xl font-bold">
            Havale/EFT bilgileri
          </h2>
          <dl className="space-y-2">
            <Fact label="Hesap sahibi" value={order.bank.holder} />
            <Fact
              label="IBAN"
              value={order.bank.iban.replace(/(.{4})(?=.)/g, "$1 ")}
            />
            <Fact label="Tutar" value={formatPrice(order.total)} />
            <Fact label="Açıklama" value={order.order_no} />
            {order.payment_due_at && (
              <Fact
                label="Son ödeme"
                value={formatDate(order.payment_due_at)}
              />
            )}
          </dl>
          <p>
            Açıklamaya sipariş numaranızı yazın. Süre dolarsa sipariş
            kendiliğinden iptal olur.
          </p>
        </section>
      )}

      <section
        aria-labelledby="urunler"
        className="space-y-3 rounded-2xl bg-white p-4"
      >
        <h2 id="urunler" className="font-baslik text-xl font-bold">
          Ürünler
        </h2>
        <ItemList items={order.items} />
        <Totals order={order} />
      </section>

      <section
        aria-labelledby="teslimat"
        className="space-y-2 rounded-2xl bg-white p-4"
      >
        <h2 id="teslimat" className="font-baslik text-xl font-bold">
          {deliveryMethods[order.delivery_method]}
        </h2>
        {order.address && (
          <p className="break-words">
            {order.address.recipient}, {formatPhone(order.address.phone)}
            <br />
            {order.address.line}, {order.address.district} /{" "}
            {order.address.city} {order.address.postal_code}
          </p>
        )}
        {order.shipment && (
          <dl className="grid gap-4 pt-2 sm:grid-cols-2">
            <Fact
              label="Kargo durumu"
              value={shipmentStatuses[order.shipment.status]}
            />
            <Fact label="Kargo firması" value={order.shipment.carrier ?? ""} />
            <Fact
              label="Takip numarası"
              value={order.shipment.tracking_no ?? ""}
            />
          </dl>
        )}
        {order.shipment?.url && (
          <a
            href={order.shipment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Kargonuzu izleyin (yeni sekmede açılır)
          </a>
        )}
        {order.pickup && <p className="break-words">{order.pickup.address}</p>}
        {order.order_status === "ready_for_pickup" && order.pickup?.until && (
          <p>Son teslim alma: {formatDate(order.pickup.until)}</p>
        )}
      </section>

      {order.can_cancel && (
        <PanelForm
          action={cancelMyOrder}
          hidden={{ no: order.order_no }}
          submit="Siparişi iptal et"
          confirm="Sipariş iptal edilsin mi? Bu işlem geri alınamaz."
        />
      )}
    </div>
  );
}
