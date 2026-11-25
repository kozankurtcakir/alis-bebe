import Form from "next/form";
import Link from "next/link";
import { CheckField, Field } from "@/components/fields";
import { formatPrice, priceInput } from "@/lib/money";
import { ProductGrid } from "./card";
import { FilterPanel } from "./filter-panel";
import {
  filterUrl,
  genders,
  type ShopFilter,
  sorts,
  type Sort,
} from "./params";
import {
  getFacets,
  getProducts,
  SHOP_PAGE_SIZE,
  type ShopFacets,
} from "./queries";

/** Süzgeç, sıralama, ürünler ve sayfa bağlantıları; kategori ve arama sayfası kullanır. */
export async function ProductList({
  path,
  category,
  query,
  filter,
}: {
  path: string;
  category?: string;
  query?: string;
  filter: ShopFilter;
}) {
  const scope = { category, query };
  const [{ products, total }, facets] = await Promise.all([
    getProducts(scope, filter),
    getFacets(scope),
  ]);
  const url = (change: Partial<ShopFilter>) =>
    filterUrl(path, query, { ...filter, page: 1, ...change });
  const chips = activeChips(filter, facets);
  const pages = Math.ceil(total / SHOP_PAGE_SIZE);
  const hasFacets = facets.has_products;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      {hasFacets && (
        <FilterPanel active={chips.length}>
          {/* Süzgeç değişince alanlar yeni değerlerle kurulsun. */}
          <FilterForm
            key={url({})}
            path={path}
            query={query}
            filter={filter}
            facets={facets}
          />
        </FilterPanel>
      )}

      <div className={`min-w-0 space-y-6 ${hasFacets ? "" : "lg:col-span-2"}`}>
        {hasFacets && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p role="status">{total} ürün</p>
            <nav aria-label="Sıralama" className="flex flex-wrap gap-x-5">
              {(Object.keys(sorts) as Sort[]).map((sort) => (
                <Link
                  key={sort}
                  href={url({ sort })}
                  aria-current={filter.sort === sort ? "true" : undefined}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline aria-[current]:font-bold aria-[current]:underline"
                >
                  {sorts[sort].label}
                </Link>
              ))}
            </nav>
          </div>
        )}

        {chips.length > 0 && (
          <ul aria-label="Seçili süzgeçler" className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.label}>
                <Link
                  href={url(chip.without)}
                  className="inline-flex min-h-11 items-center rounded-full bg-petrol px-4 text-white hover:bg-petrol/90"
                >
                  {chip.label}
                  <span aria-hidden className="ml-2">
                    ×
                  </span>
                  <span className="sr-only"> süzgecini kaldır</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={filterUrl(path, query, { sort: filter.sort })}
                className="inline-flex min-h-11 items-center px-2 underline"
              >
                Hepsini kaldır
              </Link>
            </li>
          </ul>
        )}

        {products.length > 0 ? (
          <ProductGrid products={products} eager={4} />
        ) : (
          <p className="py-8">
            {hasFacets
              ? "Seçtiğiniz süzgeçlere uyan ürün yok."
              : query
                ? "Aradığınız ürünü bulamadık. Daha kısa bir sözcükle deneyin."
                : "Bu bölümde henüz ürün yok."}
          </p>
        )}

        {products.length > 0 && pages > 1 && (
          <nav
            aria-label="Sayfalar"
            className="flex items-center justify-between gap-4"
          >
            {filter.page > 1 ? (
              <Link href={url({ page: filter.page - 1 })} className={pageLink}>
                Önceki
              </Link>
            ) : (
              <span />
            )}
            <span>
              Sayfa {filter.page} / {pages}
            </span>
            {filter.page < pages ? (
              <Link href={url({ page: filter.page + 1 })} className={pageLink}>
                Sonraki
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

const pageLink =
  "inline-flex min-h-11 items-center px-2 font-semibold underline";

function FilterForm({
  path,
  query,
  filter,
  facets,
}: {
  path: string;
  query?: string;
  filter: ShopFilter;
  facets: ShopFacets;
}) {
  return (
    <Form action={path} className="space-y-6" aria-label="Süzgeçler">
      {query && <input type="hidden" name="q" value={query} />}
      {sorts[filter.sort].param && (
        <input type="hidden" name="sirala" value={sorts[filter.sort].param} />
      )}
      <Group
        title="Beden"
        name="beden"
        options={facets.sizes}
        selected={filter.sizes}
      />
      <Group
        title="Renk"
        name="renk"
        options={facets.colors}
        selected={filter.colors}
      />
      <Group
        title="Cinsiyet"
        name="cinsiyet"
        options={facets.genders.map((g) => ({
          value: genders[g].param,
          label: genders[g].label,
        }))}
        selected={filter.genders.map((g) => genders[g].param)}
      />
      <Group
        title="Marka"
        name="marka"
        options={facets.brands}
        selected={filter.brands}
      />
      <fieldset className="space-y-2">
        <legend className="font-baslik text-lg font-bold">Fiyat (TL)</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="En az"
            name="en-az"
            inputMode="decimal"
            maxLength={12}
            defaultValue={filter.min === null ? "" : priceInput(filter.min)}
          />
          <Field
            label="En çok"
            name="en-cok"
            inputMode="decimal"
            maxLength={12}
            defaultValue={filter.max === null ? "" : priceInput(filter.max)}
          />
        </div>
      </fieldset>
      <CheckField
        label="Yalnızca stokta olanlar"
        name="stok"
        value="var"
        defaultChecked={filter.inStock}
      />
      <button className="min-h-11 w-full rounded-full bg-hardal px-6 font-semibold hover:bg-hardal/80">
        Uygula
      </button>
    </Form>
  );
}

function Group({
  title,
  name,
  options,
  selected,
}: {
  title: string;
  name: string;
  options: { value: string; label: string; hex?: string }[];
  selected: string[];
}) {
  // Tek seçenekli süzgeç işe yaramaz; seçiliyse kaldırılabilsin diye gösterilir.
  if (options.length < 2 && selected.length === 0) return null;
  return (
    <fieldset>
      <legend className="font-baslik text-lg font-bold">{title}</legend>
      <div className="flex max-h-64 flex-wrap gap-x-5 overflow-y-auto">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
              className="size-5 accent-petrol"
            />
            {o.hex && (
              <span
                aria-hidden
                className="size-5 rounded-full border border-gri"
                style={{ background: o.hex }}
              />
            )}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Seçili her süzgeç ve o süzgeç kaldırılınca kalan durum. */
function activeChips(filter: ShopFilter, facets: ShopFacets) {
  const chips: { label: string; without: Partial<ShopFilter> }[] = [];
  const add = <T extends string>(
    key: "sizes" | "colors" | "brands" | "genders",
    values: T[],
    label: (value: T) => string,
  ) => {
    for (const value of values) {
      chips.push({
        label: label(value),
        without: { [key]: values.filter((v) => v !== value) },
      });
    }
  };
  const named = (options: { value: string; label: string }[]) => (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;

  add("sizes", filter.sizes, named(facets.sizes));
  add("colors", filter.colors, named(facets.colors));
  add("genders", filter.genders, (g) => genders[g].label);
  add("brands", filter.brands, named(facets.brands));
  if (filter.min !== null) {
    chips.push({
      label: `En az ${formatPrice(filter.min)}`,
      without: { min: null },
    });
  }
  if (filter.max !== null) {
    chips.push({
      label: `En çok ${formatPrice(filter.max)}`,
      without: { max: null },
    });
  }
  if (filter.inStock) {
    chips.push({ label: "Stokta olanlar", without: { inStock: false } });
  }
  return chips;
}
