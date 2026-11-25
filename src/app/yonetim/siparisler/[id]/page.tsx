import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckField, Field, SelectField, TextArea } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { formatPrice } from "@/lib/money";
import { formatPhone } from "@/modules/account/validation";
import { requirePermission } from "@/modules/auth/access";
import {
  addNote,
  advanceOrder,
  approveOrder,
  cancelOrder,
  collectPayment,
  confirmTransfer,
  matchTransfer,
  verifyPhone,
} from "@/modules/orders/actions";
import { checkOrderPayment } from "@/modules/payments/actions";
import {
  attemptStatuses,
  canCancel,
  cancelCodes,
  deliveryMethods,
  flagLabels,
  formatDate,
  historyText,
  nextSteps,
  orderStatuses,
  paymentMethods,
  paymentStatuses,
} from "@/modules/orders/labels";
import { Fact, ItemList, Totals } from "@/modules/orders/parts";
import { getOrderDetail, type OrderDetail } from "@/modules/orders/queries";
import { CodSettlement, Shipment } from "@/modules/shipping/panel";
import { listCarriers } from "@/modules/shipping/queries";

export const metadata: Metadata = { title: "Sipariş" };

export default async function OrderDetailPage({
  params,
}: PageProps<"/yonetim/siparisler/[id]">) {
  const { permissions } = await requirePermission("orders.read");
  const { id } = await params;
  const o = await getOrderDetail(id);
  if (!o) notFound();

  const can = (permission: string) => permissions.includes(permission);
  const ships =
    o.delivery_method === "shipping" &&
    (o.order_status === "preparing" || o.shipment_events.length > 0);
  const carriers = ships ? await listCarriers() : [];
  const hidden = { id: o.id };
  const open =
    o.order_status === "pending_payment" ||
    o.order_status === "awaiting_approval";
  const steps = nextSteps(o.order_status, o.delivery_method).filter((s) =>
    can(s === "preparing" ? "orders.approve" : "shipping.write"),
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-baslik text-3xl font-bold">{o.order_no}</h1>
        {o.flags.map((f) => (
          <p key={f} className="font-semibold text-nar">
            {flagLabels[f] ?? f}
          </p>
        ))}
      </div>

      <dl className="grid gap-4 rounded-xl bg-white p-4 sm:grid-cols-2">
        <Fact label="Tarih" value={formatDate(o.created_at)} />
        <Fact
          label="Durum"
          value={[
            orderStatuses[o.order_status],
            o.cancel_code && cancelCodes[o.cancel_code],
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact
          label="Ödeme"
          value={[
            paymentMethods[o.payment_method],
            paymentStatuses[o.payment_status],
            o.collected_as && (o.collected_as === "cash" ? "nakit" : "kart"),
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact label="Teslimat" value={deliveryMethods[o.delivery_method]} />
        {o.order_status === "pending_payment" && o.payment_due_at && (
          <Fact label="Son ödeme" value={formatDate(o.payment_due_at)} />
        )}
        {o.order_status === "ready_for_pickup" && o.pickup_until && (
          <Fact label="Son teslim alma" value={formatDate(o.pickup_until)} />
        )}
        <Fact
          label={o.is_member ? "Müşteri (üye)" : "Müşteri (misafir)"}
          value={o.contact_name}
        />
        <Fact label="E-posta" value={o.email} />
        <Fact
          label="Telefon"
          value={`${formatPhone(o.phone)} · ${o.phone_verified ? "doğrulandı" : "doğrulanmadı"}`}
        />
      </dl>

      <Section title="Ürünler">
        <ItemList items={o.items} />
        <Totals order={o} />
      </Section>

      <Addresses order={o} />

      {(o.transfers.length > 0 || o.payment_method === "transfer") && (
        <Section title="Havale/EFT">
          <Transfers order={o} canConfirm={can("transfers.confirm")} />
          {can("transfers.match") &&
            (o.order_status === "pending_payment" ||
              o.cancel_code === "expired") && (
              <PanelForm
                action={matchTransfer}
                hidden={hidden}
                submit="Havaleyi yaz"
                resetOnOk
                once
              >
                <p className="text-sm">
                  Yalnızca bankada gördüğünüz parayı yazın; dekont yeterli
                  değildir.
                </p>
                <Field
                  label="Gelen tutar (TL)"
                  name="amount"
                  inputMode="decimal"
                  hint="Örnek: 249,90"
                  required
                  maxLength={15}
                />
                <Field
                  label="Banka işlem numarası"
                  name="reference"
                  required
                  maxLength={100}
                />
              </PanelForm>
            )}
        </Section>
      )}

      {o.payment_method === "card" && (
        <Section title="Kart ödemesi">
          <Attempts order={o} />
          {can("orders.approve") &&
            o.attempts.some((a) => a.status === "started") && (
              <PanelForm
                action={checkOrderPayment}
                hidden={{ no: o.order_no }}
                submit="Ödemeyi sorgula"
              />
            )}
        </Section>
      )}

      {ships && (
        <Section title="Kargo">
          <Shipment
            order={o}
            carriers={carriers}
            canWrite={can("shipping.write")}
          />
        </Section>
      )}

      {o.cod && (
        <Section title="Kargodan gelecek para">
          <CodSettlement cod={o.cod} canWrite={can("cod.reconcile")} />
        </Section>
      )}

      <Section title="İşlemler">
        {open && !o.phone_verified && can("orders.note") && (
          <PanelForm
            action={verifyPhone}
            hidden={hidden}
            submit="Telefonu doğruladım"
            confirm="Müşteriyi aradınız ve siparişi doğruladınız mı?"
          />
        )}
        {o.order_status === "awaiting_approval" && can("orders.approve") && (
          <PanelForm
            action={approveOrder}
            hidden={hidden}
            submit="Siparişi onayla"
            confirm={
              o.flags.length > 0
                ? "Bu siparişte uyarı var. Yine de onaylansın mı?"
                : "Sipariş onaylansın mı? Stok düşülecek."
            }
          />
        )}
        {o.payment_method === "store" &&
          o.order_status === "ready_for_pickup" &&
          o.payment_status === "pending" &&
          can("orders.approve") && (
            <PanelForm
              action={collectPayment}
              hidden={hidden}
              submit="Tahsilatı kaydet"
              confirm={`${formatPrice(o.total)} tahsil edildi mi?`}
            >
              <SelectField
                label="Tahsilat"
                name="as"
                empty="Seçin"
                defaultValue=""
                required
                options={[
                  { value: "cash", label: "Nakit" },
                  { value: "card", label: "Kart (mağaza POS'u)" },
                ]}
              />
            </PanelForm>
          )}
        {steps.map((to) => (
          <PanelForm
            key={to}
            action={advanceOrder}
            hidden={{ ...hidden, to }}
            submit={`Duruma geç: ${orderStatuses[to]}`}
            confirm={`Durum "${orderStatuses[to]}" olsun mu?`}
          />
        ))}
        {can("orders.note") && (
          <PanelForm
            action={addNote}
            hidden={hidden}
            submit="Not ekle"
            resetOnOk
          >
            <TextArea label="Not" name="note" required maxLength={500} />
          </PanelForm>
        )}
        {canCancel(o.order_status) && can("orders.cancel") && (
          <PanelForm
            action={cancelOrder}
            hidden={hidden}
            submit="Siparişi iptal et"
            confirm="Sipariş iptal edilsin mi? Bu işlem geri alınamaz."
          >
            <Field
              label="İptal nedeni"
              name="note"
              required
              maxLength={500}
              hint="Müşteriye gösterilmez."
            />
          </PanelForm>
        )}
      </Section>

      <Section title="Geçmiş">
        <ol className="space-y-3">
          {o.history.map((h) => (
            <li key={h.seq}>
              <p className="font-semibold">{historyText(h)}</p>
              {h.note && <p className="break-words">{h.note}</p>}
              <p className="text-sm text-gri">
                {formatDate(h.at)} · {h.actor ?? "Sistem veya misafir"}
              </p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section aria-label={title} className="space-y-4 rounded-xl bg-white p-4">
    <h2 className="font-baslik text-xl font-bold">{title}</h2>
    {children}
  </section>
);

function Addresses({ order }: { order: OrderDetail }) {
  const { delivery, invoice } = order.addresses;
  return (
    <Section title="Adresler">
      {[["Teslimat", delivery] as const, ["Fatura", invoice] as const].map(
        ([label, a]) =>
          a && (
            <div key={label}>
              <h3 className="font-semibold">{label}</h3>
              <p className="break-words">
                {a.recipient}, {formatPhone(a.phone)}
                <br />
                {a.line}, {a.district} / {a.city} {a.postal_code}
              </p>
            </div>
          ),
      )}
      {invoice.company && (
        <p className="break-words">
          {invoice.company} · {invoice.tax_office} · {invoice.tax_no}
        </p>
      )}
    </Section>
  );
}

function Attempts({ order }: { order: OrderDetail }) {
  if (order.attempts.length === 0) return <p>Ödeme denenmedi.</p>;
  return (
    <ul className="space-y-3">
      {order.attempts.map((a) => (
        <li key={a.id}>
          <p>
            <strong>{formatPrice(a.amount)}</strong> ·{" "}
            {attemptStatuses[a.status]}
            {a.paid_amount !== null &&
              a.paid_amount !== a.amount &&
              ` (gelen ${formatPrice(a.paid_amount)})`}
          </p>
          <p className="text-sm break-words text-gri">
            {[
              formatDate(a.created_at),
              a.installments > 1 && `${a.installments} taksit`,
              a.ref,
              a.error_code,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Transfers({
  order,
  canConfirm,
}: {
  order: OrderDetail;
  canConfirm: boolean;
}) {
  if (order.transfers.length === 0) return <p>Havale yazılmadı.</p>;
  const decidable =
    order.order_status === "pending_payment" || order.cancel_code === "expired";
  return (
    <ul className="space-y-4">
      {order.transfers.map((t) => (
        <li key={t.id} className="space-y-2">
          <p className="break-words">
            <strong>{formatPrice(t.amount)}</strong> · {t.reference}
          </p>
          <p className="text-sm text-gri">
            Yazan: {t.matched_by}, {formatDate(t.matched_at)}
            {t.confirmed_at &&
              ` · Onaylayan: ${t.confirmed_by}, ${formatDate(t.confirmed_at)}`}
          </p>
          {canConfirm && decidable && (
            <PanelForm
              action={confirmTransfer}
              hidden={{ id: t.id }}
              submit="Havaleyi onayla"
              subject={t.reference}
              confirm="Parayı banka hesabında gördünüz mü?"
            >
              <CheckField
                label="Fazla gelen parayı kabul ediyorum"
                name="over"
              />
            </PanelForm>
          )}
        </li>
      ))}
    </ul>
  );
}
