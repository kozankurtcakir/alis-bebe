import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/money";
import type { ShopCard } from "./queries";

export function Price({
  price,
  compareAt,
  from = false,
}: {
  price: number;
  compareAt: number | null;
  /** Başka varyantlar daha pahalıysa "başlayan" yazılır. */
  from?: boolean;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      {compareAt !== null && (
        <s className="text-sm text-gri">
          <span className="sr-only">Eski fiyat </span>
          {formatPrice(compareAt)}
        </s>
      )}
      <span className="font-bold">
        {compareAt !== null && <span className="sr-only">Yeni fiyat </span>}
        {formatPrice(price)}
      </span>
      {from && <span className="text-sm text-gri">başlayan fiyat</span>}
    </p>
  );
}

export function ProductGrid({
  products,
  eager = 0,
}: {
  products: ShopCard[];
  /** Ekranın ilk bölümünde görünen, bekletilmeden yüklenecek görsel sayısı. */
  eager?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.slug} className="group relative min-w-0">
          <div className="relative aspect-4/5 overflow-hidden rounded-2xl bg-nane">
            {p.image_path && (
              <Image
                src={`/gorsel/${p.image_path}`}
                alt={p.image_alt ?? ""}
                fill
                sizes="(min-width: 1152px) 270px, (min-width: 640px) 33vw, 50vw"
                loading={i < eager ? "eager" : "lazy"}
                fetchPriority={i === 0 && eager > 0 ? "high" : "auto"}
                className="object-cover"
              />
            )}
            {p.sold_out && (
              <span className="absolute bottom-2 left-2 rounded-full bg-white px-3 py-1 text-sm font-semibold">
                Tükendi
              </span>
            )}
          </div>
          <Link
            href={`/urun/${p.slug}`}
            className="mt-3 block font-semibold break-words underline-offset-4 group-hover:underline after:absolute after:inset-0"
          >
            {p.name}
          </Link>
          <Price
            price={p.price}
            compareAt={p.compare_at_price}
            from={p.has_more_prices}
          />
          {p.color_count > 1 && (
            <p className="text-sm text-gri">{p.color_count} renk</p>
          )}
        </li>
      ))}
    </ul>
  );
}
