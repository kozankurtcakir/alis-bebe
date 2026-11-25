import type { Metadata } from "next";
import { ProductList } from "@/modules/shop/list";
import { parseFilter, parseQuery } from "@/modules/shop/params";

export const instant = false;

export async function generateMetadata({
  searchParams,
}: PageProps<"/ara">): Promise<Metadata> {
  const query = parseQuery(await searchParams);
  return { title: query ? `“${query}” araması` : "Tüm ürünler" };
}

export default async function SearchPage({ searchParams }: PageProps<"/ara">) {
  const raw = await searchParams;
  const query = parseQuery(raw);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <h1 className="font-baslik text-4xl font-bold break-words">
        {query ? `“${query}” için sonuçlar` : "Tüm ürünler"}
      </h1>
      <ProductList
        path="/ara"
        query={query || undefined}
        filter={parseFilter(raw)}
      />
    </div>
  );
}
