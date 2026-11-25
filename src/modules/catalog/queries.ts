import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import {
  audienceLabels,
  genderLabels,
  keysOf,
  productTypeLabels,
  sizeGroupLabels,
  statusLabels,
} from "./labels";

// Okuma yetkisini RLS uygular; sayfalar ayrıca catalog.read iznini kontrol eder.

const named = z.object({ id: z.string(), name: z.string(), slug: z.string() });
const status = z.enum(keysOf(statusLabels));

const listsSchema = z.object({
  categories: z.array(
    named.extend({
      parent_id: z.string().nullable(),
      sort_order: z.number(),
      is_active: z.boolean(),
    }),
  ),
  brands: z.array(named),
  colors: z.array(named.extend({ hex: z.string(), code: z.string() })),
  sizes: z.array(
    z.object({
      id: z.string(),
      size_group: z.enum(keysOf(sizeGroupLabels)),
      name: z.string(),
      code: z.string(),
      age_min_months: z.number().nullable(),
      age_max_months: z.number().nullable(),
      sort_order: z.number(),
    }),
  ),
  size_charts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category_id: z.string().nullable(),
      rows: z.array(z.array(z.string())),
    }),
  ),
});

export type Lists = z.infer<typeof listsSchema>;

/** Kategori, marka, renk, beden ve beden tabloları. */
export async function getLists() {
  const supabase = await createClient();
  const [categories, brands, colors, sizes, size_charts] = await Promise.all([
    supabase.from("categories").select().order("sort_order").order("name"),
    supabase.from("brands").select().order("name"),
    supabase.from("colors").select().order("name"),
    supabase.from("sizes").select().order("sort_order").order("name"),
    supabase.from("size_charts").select().order("name"),
  ]);
  const results = { categories, brands, colors, sizes, size_charts };
  for (const { error } of Object.values(results)) {
    if (error) throw new Error(`Katalog listesi okunamadı: ${error.code}`);
  }
  return listsSchema.parse(
    Object.fromEntries(
      Object.entries(results).map(([key, { data }]) => [key, data]),
    ),
  );
}

export const PRODUCT_PAGE_SIZE = 25;

const summarySchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    status,
    product_variants: z.array(z.object({ count: z.number() })),
    product_images: z.array(z.object({ path: z.string() })),
  }),
);

/** Fazladan istenen bir kayıt "sonraki sayfa var" bilgisidir. */
export async function listProducts(filter: {
  query: string;
  status?: string;
  page: number;
}) {
  const supabase = await createClient();
  const query = filter.query.trim();

  const from = (filter.page - 1) * PRODUCT_PAGE_SIZE;
  let request = (
    query
      ? supabase.rpc("search_products", { p_query: query })
      : supabase.from("products")
  )
    // Fonksiyon sonucu yalnızca seçilen alanlarla sıralanabilir.
    .select(
      "id, created_at, name, status, product_variants(count), product_images(path)",
    )
    .order("created_at", { ascending: false })
    .order("id")
    .order("sort_order", { referencedTable: "product_images" })
    .limit(1, { referencedTable: "product_images" })
    .range(from, from + PRODUCT_PAGE_SIZE);
  if (filter.status) request = request.eq("status", filter.status);

  const { data, error } = await request;
  if (error) throw new Error(`Ürünler okunamadı: ${error.code}`);
  const rows = summarySchema.parse(data);
  return {
    products: rows.slice(0, PRODUCT_PAGE_SIZE),
    hasNext: rows.length > PRODUCT_PAGE_SIZE,
  };
}

const productSchema = z.object({
  id: z.string(),
  product_no: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  product_type: z.enum(keysOf(productTypeLabels)),
  audience: z.enum(keysOf(audienceLabels)),
  gender: z.enum(keysOf(genderLabels)),
  brand_id: z.string().nullable(),
  material: z.string(),
  care: z.string().nullable(),
  vat_bps: z.number(),
  status,
  product_categories: z.array(
    z.object({ category_id: z.string(), is_primary: z.boolean() }),
  ),
  product_variants: z.array(
    z.object({
      id: z.string(),
      color_id: z.string().nullable(),
      size_id: z.string().nullable(),
      sku: z.string(),
      barcode: z.string().nullable(),
      price: z.number(),
      compare_at_price: z.number().nullable(),
      desi: z.number().nullable(),
      is_active: z.boolean(),
      // costs.read izni yoksa RLS boş döndürür.
      variant_costs: z.object({ cost: z.number() }).nullable(),
    }),
  ),
  product_images: z.array(
    z.object({
      id: z.string(),
      color_id: z.string().nullable(),
      path: z.string(),
      width: z.number(),
      height: z.number(),
      alt: z.string(),
      sort_order: z.number(),
    }),
  ),
});

export type Product = z.infer<typeof productSchema>;

export async function getProduct(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "*, product_categories(*), product_variants(*, variant_costs(cost)), product_images(*)",
    )
    .eq("id", id)
    .order("sku", { referencedTable: "product_variants" })
    .order("sort_order", { referencedTable: "product_images" })
    .order("created_at", { referencedTable: "product_images" })
    .maybeSingle();
  if (error) throw new Error(`Ürün okunamadı: ${error.code}`);
  return data ? productSchema.parse(data) : null;
}
