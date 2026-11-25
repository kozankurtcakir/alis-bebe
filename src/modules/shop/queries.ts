import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createPublicClient } from "@/lib/supabase";
import type { ShopFilter } from "./params";

// Ziyaretçi tabloları okuyamaz; yalnızca shop_* fonksiyonlarının verdiği alanları görür.

async function call(fn: string, args: Record<string, unknown> = {}) {
  const supabase = await createPublicClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`Mağaza okunamadı (${fn}): ${error.code}`);
  return data as unknown;
}

const categorySchema = z.array(
  z.object({
    name: z.string(),
    slug: z.string(),
    parent_slug: z.string().nullable(),
  }),
);

export type ShopCategory = z.infer<typeof categorySchema>[number];

/** Aynı istekte menü ve sayfa bir kez sorar. */
export const getCategories = cache(async () =>
  categorySchema.parse(await call("shop_categories")),
);

const cardSchema = z.array(
  z.object({
    name: z.string(),
    slug: z.string(),
    price: z.number(),
    compare_at_price: z.number().nullable(),
    has_more_prices: z.boolean(),
    color_count: z.number(),
    sold_out: z.boolean(),
    image_path: z.string().nullable(),
    image_alt: z.string().nullable(),
    total: z.number(),
  }),
);

export type ShopCard = z.infer<typeof cardSchema>[number];

export const SHOP_PAGE_SIZE = 24;

type Scope = { category?: string; query?: string };

export async function getProducts(
  scope: Scope,
  filter: Partial<ShopFilter> = {},
  limit = SHOP_PAGE_SIZE,
) {
  const products = cardSchema.parse(
    await call("shop_products", {
      p_category: scope.category ?? null,
      p_query: scope.query ?? null,
      p_sizes: filter.sizes ?? [],
      p_colors: filter.colors ?? [],
      p_brands: filter.brands ?? [],
      p_genders: filter.genders ?? [],
      p_min: filter.min ?? null,
      p_max: filter.max ?? null,
      p_in_stock: filter.inStock ?? false,
      p_sort: filter.sort ?? "new",
      p_page: filter.page ?? 1,
      p_limit: limit,
    }),
  );
  return { products, total: products[0]?.total ?? 0 };
}

const option = z.object({ value: z.string(), label: z.string() });
const facetSchema = z.object({
  sizes: z.array(option),
  colors: z.array(option.extend({ hex: z.string() })),
  brands: z.array(option),
  genders: z.array(z.enum(["female", "male", "unisex"])),
  has_products: z.boolean(),
});

export type ShopFacets = z.infer<typeof facetSchema>;

export const getFacets = async (scope: Scope) =>
  facetSchema.parse(
    await call("shop_facets", {
      p_category: scope.category ?? null,
      p_query: scope.query ?? null,
    }),
  );

const productSchema = z.object({
  name: z.string(),
  description: z.string(),
  material: z.string(),
  care: z.string().nullable(),
  brand: z.string().nullable(),
  categories: z.array(z.object({ name: z.string(), slug: z.string() })),
  images: z.array(
    z.object({
      path: z.string(),
      alt: z.string(),
      color: z.string().nullable(),
    }),
  ),
  variants: z.array(
    z.object({
      id: z.string(),
      price: z.number(),
      compare_at_price: z.number().nullable(),
      color: z
        .object({ slug: z.string(), name: z.string(), hex: z.string() })
        .nullable(),
      size: z.object({ code: z.string(), name: z.string() }).nullable(),
      stock: z.enum(["in", "low", "out"]),
    }),
  ),
  size_charts: z.array(
    z.object({ name: z.string(), rows: z.array(z.array(z.string())) }),
  ),
});

export type ShopProduct = z.infer<typeof productSchema>;

/** Başlık ve sayfa aynı istekte bir kez sorar. Yayında değilse null. */
export const getProduct = cache(async (slug: string) =>
  productSchema.nullable().parse(await call("shop_product", { p_slug: slug })),
);
