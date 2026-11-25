import Link from "next/link";
import { ProductGrid } from "@/modules/shop/card";
import { getCategories, getProducts } from "@/modules/shop/queries";

// Sayfa bütünüyle hazır olunca gösterilir.
export const instant = false;

const houses: { wall: string; roof: string; window?: string }[] = [
  { wall: "#F4B942", roof: "#B93A4B" },
  { wall: "#FFFFFF", roof: "#17454F", window: "#CFE8E1" },
  { wall: "#B93A4B", roof: "#17454F" },
  { wall: "#17454F", roof: "#B93A4B" },
  { wall: "#F4B942", roof: "#17454F" },
];

/** Odunpazarı evlerinden esinlenen süs çizimi. */
function Houses() {
  return (
    <svg
      viewBox="0 0 500 150"
      aria-hidden="true"
      className="w-full max-w-2xl self-center"
    >
      {houses.map(({ wall, roof, window = "#F4F9F8" }, i) => (
        <g key={i} transform={`translate(${i * 100} 0)`}>
          <rect x="8" y="55" width="84" height="95" fill={wall} />
          <path d="M0 57 50 20l50 37Z" fill={roof} />
          <rect x="20" y="70" width="22" height="26" rx="3" fill={window} />
          <rect x="58" y="70" width="22" height="26" rx="3" fill={window} />
          <path d="M39 150v-28a11 11 0 0 1 22 0v28Z" fill={roof} />
        </g>
      ))}
    </svg>
  );
}

export default async function Home() {
  const [categories, { products }] = await Promise.all([
    getCategories(),
    getProducts({}, {}, 8),
  ]);

  return (
    <div className="space-y-12">
      <div className="flex flex-col items-center gap-8 bg-nane px-5 pt-12 text-center">
        <div>
          <h1 className="font-baslik text-4xl leading-tight font-bold text-balance sm:text-6xl">
            Minikten büyüğe yumuşacık gardırop
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-balance">
            Eskişehir&apos;deki mağazamızdan bebek, çocuk ve aile giyimi.
          </p>
          <Link
            href="/ara"
            className="mt-6 inline-flex min-h-12 items-center rounded-full bg-hardal px-8 font-semibold hover:bg-hardal/80"
          >
            Ürünleri keşfet
          </Link>
        </div>
        <Houses />
      </div>

      <div className="mx-auto max-w-6xl space-y-12 px-4">
        <section aria-label="Kategoriler">
          <h2 className="font-baslik text-2xl font-bold">Kategoriler</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {categories
              .filter((c) => c.parent_slug === null)
              .map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/kategori/${c.slug}`}
                    className="flex min-h-20 items-center rounded-2xl bg-white px-6 font-baslik text-xl font-bold hover:bg-hardal"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
          </ul>
        </section>

        <section aria-label="Yeni gelenler">
          <h2 className="font-baslik text-2xl font-bold">Yeni gelenler</h2>
          <div className="mt-4">
            {products.length > 0 ? (
              <ProductGrid products={products} />
            ) : (
              <p>Ürünlerimiz hazırlanıyor, çok yakında burada.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
