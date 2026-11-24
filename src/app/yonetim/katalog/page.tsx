import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import { requirePermission } from "@/modules/auth/access";
import { Field, SelectField } from "@/components/fields";
import { keysOf, statusLabels, toOptions } from "@/modules/catalog/labels";
import { listProducts } from "@/modules/catalog/queries";

export const metadata: Metadata = { title: "Ürünler" };

const filterSchema = z.object({
  ara: z.string().max(100).catch(""),
  durum: z.enum(keysOf(statusLabels)).optional().catch(undefined),
  sayfa: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function ProductsPage({
  searchParams,
}: PageProps<"/yonetim/katalog">) {
  const access = await requirePermission("catalog.read");
  const { ara, durum, sayfa } = filterSchema.parse(await searchParams);
  const { products, hasNext } = await listProducts({
    query: ara,
    status: durum,
    page: sayfa,
  });

  const pageLink = (page: number) =>
    `?${new URLSearchParams({ ara, ...(durum && { durum }), sayfa: String(page) })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-baslik text-3xl font-bold">Ürünler</h1>
        {access.permissions.includes("catalog.write") && (
          <Link
            href="/yonetim/katalog/yeni"
            className="inline-flex min-h-11 items-center rounded-xl bg-petrol px-5 font-semibold text-white hover:bg-petrol/90"
          >
            Yeni ürün
          </Link>
        )}
      </div>

      <form className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field
          label="Ürün adı, SKU veya barkod"
          name="ara"
          type="search"
          defaultValue={ara}
          maxLength={100}
        />
        <SelectField
          label="Durum"
          name="durum"
          empty="Hepsi"
          options={toOptions(statusLabels)}
          defaultValue={durum ?? ""}
        />
        <button className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane">
          Ara
        </button>
      </form>

      {products.length === 0 && <p>Ürün bulunamadı.</p>}
      <ul className="divide-y divide-gri/40 border-y border-gri/40">
        {products.map((p) => (
          <li key={p.id} className="flex items-center gap-4 py-3">
            {p.product_images[0] ? (
              <Image
                src={`/gorsel/${p.product_images[0].path}`}
                alt=""
                width={56}
                height={56}
                className="size-14 rounded-lg object-cover"
              />
            ) : (
              <span aria-hidden className="size-14 rounded-lg bg-nane" />
            )}
            <div className="min-w-0">
              <Link
                href={`/yonetim/katalog/${p.id}`}
                className="inline-flex min-h-11 items-center font-semibold break-words underline underline-offset-4"
              >
                {p.name}
              </Link>
              <p className="text-sm text-gri">
                {statusLabels[p.status]} · {p.product_variants[0]?.count ?? 0}{" "}
                varyant
              </p>
            </div>
          </li>
        ))}
      </ul>

      <nav aria-label="Sayfalar" className="flex justify-between">
        {sayfa > 1 ? (
          <Link href={pageLink(sayfa - 1)} className="underline">
            Önceki
          </Link>
        ) : (
          <span />
        )}
        {hasNext && (
          <Link href={pageLink(sayfa + 1)} className="underline">
            Sonraki
          </Link>
        )}
      </nav>
    </div>
  );
}
