import { parsePrice, priceInput } from "@/lib/money";

// Adresteki süzgeçler. Bozuk veya bilinmeyen değer yok sayılır; sayfa hata vermez.

export const sorts = {
  new: { param: "", label: "Önerilen" },
  price_asc: { param: "fiyat-artan", label: "Fiyat artan" },
  price_desc: { param: "fiyat-azalan", label: "Fiyat azalan" },
} as const;
export type Sort = keyof typeof sorts;

export const genders = {
  female: { param: "kiz-kadin", label: "Kız / Kadın" },
  male: { param: "erkek", label: "Erkek" },
  unisex: { param: "unisex", label: "Unisex" },
} as const;
type Gender = keyof typeof genders;

export type ShopFilter = {
  sizes: string[];
  colors: string[];
  brands: string[];
  genders: Gender[];
  min: number | null;
  max: number | null;
  inStock: boolean;
  sort: Sort;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

const first = (value: Raw[string]) => [value].flat()[0] ?? "";

const list = (value: Raw[string], pattern: RegExp) =>
  [...new Set([value].flat().filter((v) => v !== undefined))]
    .filter((v) => v.length <= 100 && pattern.test(v))
    .slice(0, 30);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const price = (value: Raw[string]) => {
  const kurus = parsePrice(first(value).slice(0, 20));
  return kurus !== null && kurus <= 100_000_000 ? kurus : null;
};

const keyByParam = <K extends string>(
  table: Record<K, { param: string }>,
  param: string,
) => (Object.keys(table) as K[]).find((k) => table[k].param === param);

export const parseQuery = (raw: Raw) =>
  first(raw.q)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 100);

export function parseFilter(raw: Raw): ShopFilter {
  const page = first(raw.sayfa);
  return {
    sizes: list(raw.beden, /^[A-Z0-9-]{1,8}$/),
    colors: list(raw.renk, SLUG),
    brands: list(raw.marka, SLUG),
    genders: list(raw.cinsiyet, SLUG).flatMap((p) => {
      const key = keyByParam(genders, p);
      return key ? [key] : [];
    }),
    min: price(raw["en-az"]),
    max: price(raw["en-cok"]),
    inStock: first(raw.stok) === "var",
    sort: keyByParam(sorts, first(raw.sirala)) ?? "new",
    page: /^[1-9]\d{0,2}$/.test(page) ? Number(page) : 1,
  };
}

/** Süzgeci adrese çevirir; varsayılan değerler yazılmaz. */
export function filterUrl(
  path: string,
  query: string | undefined,
  filter: Partial<ShopFilter>,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const v of filter.sizes ?? []) params.append("beden", v);
  for (const v of filter.colors ?? []) params.append("renk", v);
  for (const v of filter.brands ?? []) params.append("marka", v);
  for (const v of filter.genders ?? []) {
    params.append("cinsiyet", genders[v].param);
  }
  if (filter.min != null) params.set("en-az", priceInput(filter.min));
  if (filter.max != null) params.set("en-cok", priceInput(filter.max));
  if (filter.inStock) params.set("stok", "var");
  if (filter.sort && sorts[filter.sort].param) {
    params.set("sirala", sorts[filter.sort].param);
  }
  if (filter.page && filter.page > 1) params.set("sayfa", String(filter.page));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
