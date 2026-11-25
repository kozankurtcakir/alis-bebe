import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/modules/auth/access";
import { listFavorites } from "@/modules/favorites/queries";
import { ProductGrid } from "@/modules/shop/card";

export const instant = false;
export const metadata: Metadata = { title: "Favorilerim" };

export default async function FavoritesPage() {
  await requireUser();
  const products = await listFavorites();

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Favorilerim</h1>
      {products.length > 0 ? (
        <ProductGrid products={products} eager={4} />
      ) : (
        <>
          <p>Henüz favoriniz yok. Ürün sayfasındaki kalple ekleyebilirsiniz.</p>
          <Link
            href="/ara"
            className="inline-flex min-h-11 items-center underline"
          >
            Ürünleri keşfet
          </Link>
        </>
      )}
    </div>
  );
}
