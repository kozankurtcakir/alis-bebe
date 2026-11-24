import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

// Okuma yetkisini veritabanı uygular; sayfalar ayrıca stock.read iznini kontrol eder.

const PAGE_SIZE = 50;

/** Fonksiyonlar 51 kayıt döndürür; sonuncusu "sonraki sayfa var" bilgisidir. */
const paged = <T>(rows: T[]) => ({
  rows: rows.slice(0, PAGE_SIZE),
  hasNext: rows.length > PAGE_SIZE,
});

const stockSchema = z.array(
  z.object({
    variant_id: z.string(),
    product_name: z.string(),
    color: z.string().nullable(),
    size: z.string().nullable(),
    sku: z.string(),
    on_hand: z.number(),
    reserved: z.number(),
    available: z.number(),
    critical_level: z.number(),
    is_sellable: z.boolean(),
  }),
);

export async function listStock(filter: {
  query: string;
  state: string;
  page: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_stock", {
    p_query: filter.query,
    p_state: filter.state,
    p_page: filter.page,
  });
  if (error) throw new Error(`Stok okunamadı: ${error.code}`);
  return paged(stockSchema.parse(data));
}

export async function getStockSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stock_summary").single();
  if (error) throw new Error(`Stok özeti okunamadı: ${error.code}`);
  return z
    .object({ critical: z.number(), out_of_stock: z.number() })
    .parse(data);
}

const name = z.object({ name: z.string() }).nullable();
const variantSchema = z.object({
  on_hand: z.number(),
  reserved: z.number(),
  critical_level: z.number(),
  product_variants: z.object({
    sku: z.string(),
    is_active: z.boolean(),
    colors: name,
    sizes: name,
    products: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
    }),
  }),
});

export async function getVariantStock(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory")
    .select(
      "on_hand, reserved, critical_level, product_variants(sku, is_active, colors(name), sizes(name), products(id, name, status))",
    )
    .eq("variant_id", id)
    .maybeSingle();
  if (error) throw new Error(`Stok okunamadı: ${error.code}`);
  if (!data) return null;

  const { product_variants: variant, ...stock } = variantSchema.parse(data);
  return {
    ...stock,
    available: stock.on_hand - stock.reserved,
    is_sellable: variant.is_active && variant.products.status !== "archived",
    sku: variant.sku,
    product: variant.products,
    label: [variant.colors?.name, variant.sizes?.name]
      .filter(Boolean)
      .join(" / "),
  };
}

const movementsSchema = z.array(
  z.object({
    id: z.string(),
    created_at: z.string(),
    delta: z.number(),
    on_hand_after: z.number(),
    reason: z.string(),
    note: z.string().nullable(),
    actor_name: z.string().nullable(),
    is_reversed: z.boolean(),
  }),
);

export async function listMovements(variant: string, page: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_stock_movements", {
    p_variant: variant,
    p_page: page,
  });
  if (error) throw new Error(`Hareketler okunamadı: ${error.code}`);
  return paged(movementsSchema.parse(data));
}
