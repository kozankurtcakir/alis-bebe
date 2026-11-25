"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { formatPrice } from "@/lib/money";
import { setCartQuantity } from "./actions";
import type { Cart, CartItem } from "./queries";

const MAX_QUANTITY = 10; // Veritabanındaki sınırla aynı; burada yalnızca düğmeyi kapatır.

export function CartList({ cart }: { cart: Cart }) {
  const [state, action, pending] = useActionState(setCartQuantity, {});
  const heading = useRef<HTMLHeadingElement>(null);

  // Kaldırılan satırdaki düğme yok olur; klavye odağı başlığa taşınır.
  useEffect(() => {
    if (state.removed) heading.current?.focus();
  }, [state]);

  return (
    <div className="space-y-6">
      <h1
        ref={heading}
        tabIndex={-1}
        className="w-fit font-baslik text-3xl font-bold"
      >
        Sepetim
      </h1>
      <p role="status" className="sr-only">
        {!pending && state.ok}
      </p>
      {state.error && !pending && (
        <p
          role="alert"
          className="rounded-xl border-l-4 border-nar bg-white p-4"
        >
          {state.error}
        </p>
      )}

      {cart.items.length === 0 ? (
        <>
          <p>Sepetiniz boş.</p>
          <Link
            href="/ara"
            className="inline-flex min-h-12 items-center rounded-full bg-hardal px-8 font-semibold hover:bg-hardal/80"
          >
            Ürünleri keşfet
          </Link>
        </>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <ul className="min-w-0 space-y-4">
            {cart.items.map((item) => (
              <li key={item.variant_id} className="rounded-2xl bg-white p-4">
                <form
                  action={action}
                  className="flex gap-4"
                  onSubmit={(e) => {
                    const button = (e.nativeEvent as SubmitEvent).submitter;
                    if (pending || button?.ariaDisabled === "true") {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="variant" value={item.variant_id} />
                  <Line item={item} />
                </form>
              </li>
            ))}
          </ul>

          <section
            aria-labelledby="ozet"
            className="h-fit space-y-3 rounded-2xl bg-nane p-6"
          >
            <h2 id="ozet" className="font-baslik text-xl font-bold">
              Özet
            </h2>
            <p className="flex flex-wrap justify-between gap-2 font-bold">
              <span>Ara toplam</span>
              <span data-testid="ara-toplam">{formatPrice(cart.subtotal)}</span>
            </p>
            <p className="text-sm">KDV dahil, kargo hariç.</p>
            <p>Sepetteki ürünler sipariş verene kadar size ayrılmaz.</p>
            {cart.items.every((i) => i.state === "ok") ? (
              <Link
                href="/odeme"
                className="flex min-h-12 items-center justify-center rounded-full bg-hardal px-6 font-semibold hover:bg-hardal/80"
              >
                Siparişi tamamla
              </Link>
            ) : (
              <p className="font-semibold">
                Sipariş için yukarıdaki uyarıları giderin.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const notes = {
  short: "Bu üründen istediğiniz kadar kalmadı; adedi azaltın.",
  out: "Bu ürün tükendi; toplama eklenmedi.",
} as const;

function Line({ item }: { item: CartItem }) {
  if (item.state === "gone") {
    return (
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Bu ürün artık satışta değil.</p>
        <Remove subject="Satışta olmayan ürün" />
      </div>
    );
  }

  const options = [item.color, item.size].filter(Boolean).join(", ");
  const subject = options ? `${item.name}, ${options}` : item.name;
  return (
    <>
      <div className="relative aspect-4/5 w-20 shrink-0 self-start overflow-hidden rounded-xl bg-nane sm:w-28">
        {item.image_path && (
          <Image
            src={`/gorsel/${item.image_path}`}
            alt={item.image_alt ?? ""}
            fill
            sizes="112px"
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={`/urun/${item.slug}`}
          className="font-semibold break-words underline-offset-4 hover:underline"
        >
          {item.name}
        </Link>
        {options && <p className="text-sm text-gri">{options}</p>}
        <p>
          <span className="font-bold">
            {formatPrice(item.price * item.quantity)}
          </span>
          {item.quantity > 1 && (
            <span className="text-sm text-gri">
              {" "}
              (tanesi {formatPrice(item.price)})
            </span>
          )}
        </p>
        {item.state !== "ok" && (
          <p className="font-semibold text-nar">{notes[item.state]}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4">
          <div className="flex items-center">
            <Step
              label={`Adedi azalt: ${subject}`}
              value={item.quantity - 1}
              off={item.quantity <= 1}
            >
              −
            </Step>
            <span className="min-w-8 text-center">
              <span className="sr-only">Adet </span>
              {item.quantity}
            </span>
            <Step
              label={`Adedi artır: ${subject}`}
              value={item.quantity + 1}
              off={item.quantity >= MAX_QUANTITY || item.state !== "ok"}
            >
              +
            </Step>
          </div>
          <Remove subject={subject} />
        </div>
      </div>
    </>
  );
}

/** Kapalı düğme odakta kalabilsin diye `disabled` yerine `aria-disabled` kullanılır. */
function Step({
  label,
  value,
  off,
  children,
}: {
  label: string;
  value: number;
  off: boolean;
  children: string;
}) {
  return (
    <button
      name="quantity"
      value={value}
      aria-label={label}
      aria-disabled={off}
      className="size-11 rounded-full border border-gri text-xl aria-disabled:border-gri/40 aria-disabled:text-gri"
    >
      {children}
    </button>
  );
}

const Remove = ({ subject }: { subject: string }) => (
  <button
    name="quantity"
    value={0}
    className="inline-flex min-h-11 items-center underline"
  >
    Kaldır<span className="sr-only">: {subject}</span>
  </button>
);
