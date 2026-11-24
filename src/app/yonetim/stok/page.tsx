import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Field, SelectField } from "@/components/fields";
import { requirePermission } from "@/modules/auth/access";
import { stateLabels, stockState } from "@/modules/stock/labels";
import { listStock } from "@/modules/stock/queries";

export const metadata: Metadata = { title: "Stok" };

const filterSchema = z.object({
  ara: z.string().max(100).catch(""),
  durum: z.enum(["all", "critical", "out"]).catch("all"),
  sayfa: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function StockPage({
  searchParams,
}: PageProps<"/yonetim/stok">) {
  await requirePermission("stock.read");
  const { ara, durum, sayfa } = filterSchema.parse(await searchParams);
  const { rows, hasNext } = await listStock({
    query: ara,
    state: durum,
    page: sayfa,
  });
  const pageLink = (page: number) =>
    `?${new URLSearchParams({ ara, durum, sayfa: String(page) })}`;

  return (
    <div className="space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Stok</h1>

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
          options={Object.entries(stateLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          defaultValue={durum}
        />
        <button className="min-h-11 rounded-xl border border-petrol px-4 font-semibold hover:bg-nane">
          Ara
        </button>
      </form>

      {rows.length === 0 && <p>Kayıt bulunamadı.</p>}
      <ul className="divide-y divide-gri/40 border-y border-gri/40">
        {rows.map((row) => {
          const state = stockState(row);
          return (
            <li
              key={row.variant_id}
              aria-label={row.sku}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/yonetim/stok/${row.variant_id}`}
                  className="inline-flex min-h-11 items-center font-semibold break-words underline underline-offset-4"
                >
                  {row.product_name}
                </Link>
                <p className="text-sm break-words text-gri">
                  {[row.color, row.size, row.sku].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-bold">
                  {row.available}
                  <span className="sr-only"> satılabilir</span>
                </p>
                {row.reserved > 0 && (
                  <p className="text-sm text-gri">{row.reserved} ayrılmış</p>
                )}
                {state && (
                  <p
                    className={`text-sm font-semibold ${row.is_sellable ? "text-nar" : "text-gri"}`}
                  >
                    {state}
                  </p>
                )}
              </div>
            </li>
          );
        })}
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
