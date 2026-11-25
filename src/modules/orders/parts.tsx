import { formatPrice } from "@/lib/money";

export const TestNotice = () => (
  <p className="rounded-xl border-l-4 border-nar bg-white p-4">
    <strong>Deneme modu:</strong> Site henüz yayında değil. Verilen siparişler
    gerçek değildir; lütfen para göndermeyin.
  </p>
);

export const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-sm text-gri">{label}</dt>
    <dd className="font-semibold break-words">{value}</dd>
  </div>
);

export function ItemList({
  items,
}: {
  items: {
    name: string;
    sku?: string;
    color: string | null;
    size: string | null;
    unit_price: number;
    quantity: number;
  }[];
}) {
  return (
    <ul className="space-y-2">
      {items.map((i, n) => (
        <li key={n} className="flex flex-wrap justify-between gap-x-4">
          <span className="min-w-0 break-words">
            {i.quantity} × {i.name}
            <span className="block text-sm text-gri">
              {[i.color, i.size, i.sku].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span>{formatPrice(i.unit_price * i.quantity)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Totals({
  order: o,
}: {
  order: {
    subtotal: number;
    shipping_fee: number;
    gift_fee: number;
    cod_fee: number;
    gift_wrap: boolean;
    total: number;
    delivery_method: string;
  };
}) {
  const rows: [string, string][] = [["Ara toplam", formatPrice(o.subtotal)]];
  if (o.delivery_method === "shipping") {
    rows.push([
      "Kargo",
      o.shipping_fee ? formatPrice(o.shipping_fee) : "Ücretsiz",
    ]);
  }
  if (o.gift_wrap) rows.push(["Hediye paketi", formatPrice(o.gift_fee)]);
  if (o.cod_fee) rows.push(["Kapıda ödeme ücreti", formatPrice(o.cod_fee)]);
  rows.push(["Toplam (KDV dahil)", formatPrice(o.total)]);

  return (
    <dl className="space-y-1 border-t border-gri/40 pt-3">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap justify-between gap-x-4 last:text-lg last:font-bold"
        >
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
