import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/modules/shop/breadcrumb";
import { ProductList } from "@/modules/shop/list";
import { parseFilter } from "@/modules/shop/params";
import { getCategories, type ShopCategory } from "@/modules/shop/queries";

export const instant = false;

export async function generateMetadata({
  params,
}: PageProps<"/kategori/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = (await getCategories()).find((c) => c.slug === slug);
  return { title: category?.name ?? "Sayfa bulunamadı" };
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/kategori/[slug]">) {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();
  const children = categories.filter((c) => c.parent_slug === category.slug);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Breadcrumb items={ancestors(category, categories)} />
      <h1 className="font-baslik text-4xl font-bold">{category.name}</h1>
      {children.length > 0 && (
        <nav aria-label="Alt kategoriler">
          <ul className="flex flex-wrap gap-2">
            {children.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/kategori/${c.slug}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-gri bg-white px-4 hover:bg-nane"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <ProductList
        path={`/kategori/${category.slug}`}
        category={category.slug}
        filter={parseFilter(await searchParams)}
      />
    </div>
  );
}

function ancestors(category: ShopCategory, all: ShopCategory[]) {
  const found: ShopCategory[] = [];
  let parent = all.find((c) => c.slug === category.parent_slug);
  while (parent) {
    found.unshift(parent);
    const slug: string | null = parent.parent_slug;
    parent = all.find((c) => c.slug === slug);
  }
  return found;
}
