import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import type { Existing, Lists } from "./plan";

// Okuma yetkisini RLS ve fonksiyonlar uygular; sayfalar ayrıca izni kontrol eder.

export async function lookup(keys: {
  skus: string[];
  barcodes: string[];
  productNos: number[];
  slugs: string[];
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_lookup", {
    p_skus: keys.skus,
    p_barcodes: keys.barcodes,
    p_product_nos: keys.productNos,
    p_slugs: keys.slugs,
  });
  if (error) throw new Error(`Kayıtlar okunamadı: ${error.code}`);
  return data as Existing;
}

/** Seçim listeleri; 1.000'lik sayfa sınırına takılmadan okunur. */
export async function getImportLists(): Promise<Lists> {
  const supabase = await createClient();
  async function all<T>(table: string, columns: string) {
    const rows: T[] = [];
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .order("id")
        .range(rows.length, rows.length + 999);
      if (error) throw new Error(`Liste okunamadı: ${error.code}`);
      rows.push(...(data as T[]));
      if (data.length < 1000) return rows;
    }
  }
  const [categories, brands, colors, sizes] = await Promise.all([
    all<Lists["categories"][number]>("categories", "id, name, parent_id"),
    all<Lists["brands"][number]>("brands", "id, name"),
    all<Lists["colors"][number]>("colors", "id, name, code"),
    all<Lists["sizes"][number]>("sizes", "id, name, code"),
  ]);
  return { categories, brands, colors, sizes };
}

const kind = z.enum(["products", "stock"]);
const jobSchema = z.object({
  id: z.string(),
  kind,
  stock_mode: z.enum(["purchase", "adjustment"]).nullable(),
  file_name: z.string(),
  status: z.enum(["invalid", "validated", "applied"]),
  total: z.number(),
  invalid: z.number(),
  created_at: z.string(),
  applied_at: z.string().nullable(),
  creator_name: z.string().nullable(),
  is_own: z.boolean(),
  price_warnings: z.number(),
  applied_before: z.boolean(),
});

export type ImportJob = z.infer<typeof jobSchema>;

const JOB_PAGE_SIZE = 25;

export async function listImports(page: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_imports", { p_page: page });
  if (error) throw new Error(`Yüklemeler okunamadı: ${error.code}`);
  const rows = z.array(jobSchema).parse(data);
  return {
    jobs: rows.slice(0, JOB_PAGE_SIZE),
    hasNext: rows.length > JOB_PAGE_SIZE,
  };
}

export async function getImport(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("list_imports", { p_job: id })
    .maybeSingle();
  if (error) throw new Error(`Yükleme okunamadı: ${error.code}`);
  return data ? jobSchema.parse(data) : null;
}

export const ROW_PAGE_SIZE = 50;
const rowSchema = z.array(
  z.object({
    id: z.string(),
    row_no: z.number(),
    action: z.enum(["create", "update", "skip", "error"]),
    raw: z.record(z.string(), z.string()),
    summary: z.array(
      z.object({
        field: z.string(),
        old: z.string().nullable(),
        new: z.string(),
      }),
    ),
    errors: z.array(z.string()),
    big_price_change: z.boolean(),
  }),
);

export const rowFilters = [
  "all",
  "create",
  "update",
  "skip",
  "error",
  "price",
] as const;
export type RowFilter = (typeof rowFilters)[number];

export async function listRows(job: string, filter: RowFilter, page: number) {
  const supabase = await createClient();
  const from = (page - 1) * ROW_PAGE_SIZE;
  let request = supabase
    .from("import_rows")
    .select("id, row_no, action, raw, summary, errors, big_price_change")
    .eq("job_id", job)
    .order("row_no")
    .range(from, from + ROW_PAGE_SIZE);
  if (filter === "price") request = request.eq("big_price_change", true);
  else if (filter !== "all") request = request.eq("action", filter);
  const { data, error } = await request;
  if (error) throw new Error(`Satırlar okunamadı: ${error.code}`);
  const rows = rowSchema.parse(data);
  return {
    rows: rows.slice(0, ROW_PAGE_SIZE),
    hasNext: rows.length > ROW_PAGE_SIZE,
  };
}

/** Her durumdaki satır sayısı. */
export async function countRows(job: string) {
  const supabase = await createClient();
  const count = async (action: string) => {
    const result = await supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job)
      .eq("action", action);
    if (result.error) throw new Error("Satırlar sayılamadı.");
    return result.count ?? 0;
  };
  const [create, update, skip, error] = await Promise.all(
    ["create", "update", "skip", "error"].map(count),
  );
  return { create, update, skip, error };
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

/** Bir dosyaya sığan varyant sayısı; yükleme sınırıyla aynıdır. */
export const EXPORT_SIZE = 1000;

export async function countVariants() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("product_variants")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`Varyantlar sayılamadı: ${error.code}`);
  return count ?? 0;
}

const name = z.object({ name: z.string() }).nullable();
const exportSchema = z.array(
  z.object({
    sku: z.string(),
    barcode: z.string().nullable(),
    price: z.number(),
    compare_at_price: z.number().nullable(),
    desi: z.number().nullable(),
    is_active: z.boolean(),
    colors: name,
    sizes: name,
    products: z.object({
      product_no: z.number(),
      name: z.string(),
      product_type: z.string(),
      audience: z.string(),
      gender: z.string(),
      vat_bps: z.number(),
      description: z.string(),
      material: z.string(),
      care: z.string().nullable(),
      brands: name,
      product_categories: z.array(
        z.object({ category_id: z.string(), is_primary: z.boolean() }),
      ),
    }),
    // stock.read izni yoksa RLS boş döndürür.
    inventory: z.object({ on_hand: z.number() }).nullable(),
  }),
);

export type ExportRow = z.infer<typeof exportSchema>[number];

export async function exportVariants(part: number) {
  const supabase = await createClient();
  const from = (part - 1) * EXPORT_SIZE;
  const { data, error } = await supabase
    .from("product_variants")
    .select(
      "sku, barcode, price, compare_at_price, desi, is_active, colors(name), sizes(name), inventory(on_hand), products(product_no, name, product_type, audience, gender, vat_bps, description, material, care, brands(name), product_categories(category_id, is_primary))",
    )
    .order("sku")
    .range(from, from + EXPORT_SIZE - 1);
  if (error) throw new Error(`Varyantlar okunamadı: ${error.code}`);
  return exportSchema.parse(data);
}
