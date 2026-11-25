"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CheckField, Field, SelectField, TextArea } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { formatPrice } from "@/lib/money";
import { cities } from "@/modules/account/cities";
import type { Address } from "@/modules/account/queries";
import { formatPhone } from "@/modules/account/validation";
import type { Cart } from "@/modules/cart/queries";
import { placeOrder } from "./actions";
import { deliveryMethods, paymentMethods } from "./labels";
import { Totals } from "./parts";
import type { CheckoutOptions } from "./queries";
import { previewTotal } from "./totals";

type Delivery = keyof typeof deliveryMethods;
type Payment = keyof typeof paymentMethods;

export function CheckoutForm({
  cart,
  options: o,
  orderKey,
  member,
}: {
  cart: Cart;
  options: CheckoutOptions;
  /** Sayfa her çizildiğinde yenilenir; aynı istek yinelenirse tek sipariş olur. */
  orderKey: string;
  /** Misafirde yoktur. */
  member?: {
    email: string;
    name: string;
    phone: string | null;
    addresses: Address[];
  };
}) {
  const payments: Record<Delivery, Payment[]> = {
    shipping: [
      ...(o.transfer ? (["transfer"] as const) : []),
      ...(o.cod ? (["cod"] as const) : []),
    ],
    pickup: [
      ...(o.transfer ? (["transfer"] as const) : []),
      ...(o.pickup_pay ? (["store"] as const) : []),
    ],
  };
  const deliveries = (["shipping", "pickup"] as const).filter(
    (d) => payments[d].length > 0 && (d === "shipping" || o.pickup),
  );

  const [chosenDelivery, setDelivery] = useState<Delivery>();
  const [chosenPayment, setPayment] = useState<Payment>();
  const [gift, setGift] = useState(false);
  const [savedId, setSavedId] = useState(member?.addresses[0]?.id ?? "");
  const [other, setOther] = useState(false);
  const [same, setSame] = useState(true);
  const [corporate, setCorporate] = useState(false);

  const delivery = chosenDelivery ?? deliveries[0];
  if (!delivery) {
    return (
      <p>Şu anda sipariş alınamıyor. Lütfen daha sonra yeniden deneyin.</p>
    );
  }
  // Teslimat değişince geçersiz kalan ödeme yöntemi ilk uygun olana döner.
  const payment =
    chosenPayment && payments[delivery].includes(chosenPayment)
      ? chosenPayment
      : payments[delivery][0];
  const total = previewTotal(cart.subtotal, { delivery, payment, gift }, o);
  const saved = member?.addresses.find((a) => a.id === savedId);

  const paymentHints: Record<Payment, string> = {
    transfer: `Ödeme bilgileri siparişten sonra gösterilir. Ürünler ${o.transfer_days} iş günü ayrılır.`,
    cod: [
      o.cod_fee > 0 && `Kapıda ödeme ücreti ${formatPrice(o.cod_fee)}.`,
      `En fazla ${formatPrice(o.cod_limit)}.`,
      o.cod_card ? "Nakit veya kart." : "Yalnızca nakit.",
    ]
      .filter(Boolean)
      .join(" "),
    store: "Ürünleri teslim alırken nakit veya kartla ödersiniz.",
  };
  const deliveryHints: Record<Delivery, string> = {
    shipping:
      cart.subtotal >= o.free_shipping_from
        ? "Ücretsiz"
        : `${formatPrice(o.shipping_fee)}. ${formatPrice(o.free_shipping_from)} ve üzeri ücretsiz.`,
    pickup: `Ücretsiz. ${o.pickup_address}. Hazır olduktan sonra ${o.pickup_days} gün bekletilir.`,
  };

  return (
    <PanelForm
      action={placeOrder}
      hidden={{ key: orderKey, expected_total: String(total.total) }}
      submit={`Siparişi ver ve ${formatPrice(total.total)} ödemeyi kabul et`}
      primary
    >
      <Group title="İletişim">
        <Field
          label="Ad soyad"
          name="name"
          defaultValue={member?.name}
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
        />
        {member ? (
          <p className="break-words">E-posta: {member.email}</p>
        ) : (
          <>
            <Field
              label="E-posta"
              name="email"
              type="email"
              autoComplete="email"
              hint="Sipariş bağlantınız bu adrese gönderilir."
              required
              maxLength={254}
            />
            <p className="text-sm">
              Üye misiniz?{" "}
              <Link
                href="/giris"
                className="inline-flex min-h-11 items-center underline"
              >
                Giriş yapın
              </Link>
            </p>
          </>
        )}
        <Field
          label="Cep telefonu"
          name="phone"
          type="tel"
          defaultValue={member?.phone ? formatPhone(member.phone) : ""}
          autoComplete="tel"
          hint="Örnek: 0555 000 00 00"
          required
          maxLength={30}
        />
      </Group>

      <Group title="Teslimat">
        <Radios
          name="delivery"
          value={delivery}
          onChange={setDelivery}
          options={deliveries.map((d) => ({
            value: d,
            label: deliveryMethods[d],
            hint: deliveryHints[d],
          }))}
        />
        {delivery === "shipping" && (
          <>
            {member && member.addresses.length > 0 && (
              <SelectField
                label="Kayıtlı adres"
                name="saved"
                value={savedId}
                onChange={(e) => setSavedId(e.target.value)}
                empty="Yeni adres yaz"
                options={member.addresses.map((a) => ({
                  value: a.id,
                  label: a.title,
                }))}
              />
            )}
            <PlaceFields key={savedId} prefix="d_" address={saved} />
            <CheckField
              label="Paketi başka biri teslim alacak"
              name="other"
              checked={other}
              onChange={(e) => setOther(e.target.checked)}
            />
            {other && (
              <div className="space-y-4" key={`kisi-${savedId}`}>
                <Field
                  label="Teslim alacak kişi"
                  name="d_recipient"
                  defaultValue={saved?.recipient}
                  required
                  minLength={2}
                  maxLength={100}
                />
                <Field
                  label="Teslim alacak kişinin telefonu"
                  name="d_phone"
                  type="tel"
                  defaultValue={saved ? formatPhone(saved.phone) : ""}
                  required
                  maxLength={30}
                />
              </div>
            )}
          </>
        )}
        <CheckField
          label={`Hediye paketi yapılsın (+${formatPrice(o.gift_fee)})`}
          name="gift"
          checked={gift}
          onChange={(e) => setGift(e.target.checked)}
        />
      </Group>

      <Group title="Fatura">
        {delivery === "shipping" && (
          <CheckField
            label="Fatura adresi teslimat adresiyle aynı"
            name="same"
            checked={same}
            onChange={(e) => setSame(e.target.checked)}
          />
        )}
        {(delivery === "pickup" || !same) && <PlaceFields prefix="f_" />}
        <CheckField
          label="Kurumsal fatura istiyorum"
          name="corporate"
          checked={corporate}
          onChange={(e) => setCorporate(e.target.checked)}
        />
        {corporate && (
          <>
            <Field
              label="Şirket unvanı"
              name="company"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={200}
            />
            <Field
              label="Vergi dairesi"
              name="tax_office"
              required
              minLength={2}
              maxLength={100}
            />
            <Field
              label="Vergi numarası"
              name="tax_no"
              inputMode="numeric"
              hint="10 rakam"
              required
              maxLength={10}
            />
          </>
        )}
      </Group>

      <Group title="Ödeme">
        <Radios
          name="payment"
          value={payment}
          onChange={setPayment}
          options={payments[delivery].map((p) => ({
            value: p,
            label: paymentMethods[p],
            hint: paymentHints[p],
          }))}
        />
      </Group>

      <Group title="Özet">
        <ul className="space-y-1">
          {cart.items.map(
            (i) =>
              i.state !== "gone" && (
                <li
                  key={i.variant_id}
                  className="flex flex-wrap justify-between gap-x-4"
                >
                  <span className="min-w-0 break-words">
                    {i.quantity} × {i.name}
                    {[i.color, i.size].some(Boolean) &&
                      ` (${[i.color, i.size].filter(Boolean).join(", ")})`}
                  </span>
                  <span>{formatPrice(i.price * i.quantity)}</span>
                </li>
              ),
          )}
        </ul>
        <Totals
          order={{
            subtotal: cart.subtotal,
            shipping_fee: total.shipping,
            gift_fee: total.gift,
            cod_fee: total.cod,
            gift_wrap: gift,
            total: total.total,
            delivery_method: delivery,
          }}
        />
        {o.documents.map((d) => (
          <div key={d.id}>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 underline">
                {d.title}
              </summary>
              <p className="rounded-xl border border-gri/40 p-4 text-sm whitespace-pre-line">
                {d.body}
              </p>
            </details>
            <CheckField
              label={`${d.title} metnini okudum ve onaylıyorum.`}
              name="documents"
              value={d.id}
              required
            />
          </div>
        ))}
      </Group>
    </PanelForm>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4 rounded-2xl bg-white p-4">
      <h2 className="font-baslik text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Radios<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name === "delivery" ? "Teslimat yöntemi" : "Ödeme yöntemi"}
      className="space-y-2"
    >
      {options.map((o) => (
        <div key={o.value}>
          <label className="flex min-h-11 items-center gap-2 font-semibold">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              aria-describedby={`${name}-${o.value}-not`}
              className="size-5 shrink-0 accent-petrol"
            />
            {o.label}
          </label>
          <p id={`${name}-${o.value}-not`} className="pl-7 text-sm text-gri">
            {o.hint}
          </p>
        </div>
      ))}
    </div>
  );
}

function PlaceFields({
  prefix,
  address: a,
}: {
  prefix: string;
  address?: Address;
}) {
  return (
    <div className="space-y-4">
      <SelectField
        label="İl"
        name={`${prefix}city`}
        defaultValue={a?.city ?? ""}
        autoComplete="address-level1"
        empty="Seçin"
        options={cities.map((c) => ({ value: c, label: c }))}
        required
      />
      <Field
        label="İlçe"
        name={`${prefix}district`}
        defaultValue={a?.district}
        autoComplete="address-level2"
        required
        minLength={2}
        maxLength={60}
      />
      <TextArea
        label="Açık adres"
        name={`${prefix}line`}
        defaultValue={a?.line}
        autoComplete="street-address"
        hint="Mahalle, sokak, kapı ve daire numarası"
        required
        minLength={10}
        maxLength={300}
      />
      <Field
        label="Posta kodu (isteğe bağlı)"
        name={`${prefix}postal_code`}
        defaultValue={a?.postal_code ?? ""}
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={5}
      />
    </div>
  );
}
