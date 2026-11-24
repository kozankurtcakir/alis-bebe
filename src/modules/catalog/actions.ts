"use server";

import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parsePrice } from "@/lib/money";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import { ImageError, processImage } from "./image";
import {
  audienceLabels,
  genderLabels,
  keysOf,
  productTypeLabels,
  sizeGroupLabels,
  statusLabels,
} from "./labels";
import { parseRows, slugify } from "./text";

export type CatalogState = { ok?: string; error?: string };
type Action = (state: CatalogState, form: FormData) => Promise<CatalogState>;

const BUCKET = "product-images";

// ---------------------------------------------------------------------------
// Alan doğrulamaları. Son kararı veritabanı verir; buradakiler ilk savunmadır.
// ---------------------------------------------------------------------------

const str = z.string("Geçersiz istek.").trim();
const id = z.uuid("Geçersiz istek.");
const optionalId = z
  .literal("")
  .or(id)
  .transform((v) => v || null);
const text = (label: string, max: number) =>
  str.min(1, `${label} yazın.`).max(max, `${label} çok uzun.`);
const slugFrom = (max: number) => str.max(max, "Adres çok uzun.");
const sortOrder = z.coerce
  .number("Sıra sayı olmalı.")
  .int("Sıra tam sayı olmalı.")
  .min(0, "Sıra eksi olamaz.")
  .max(100_000, "Sıra çok büyük.");
const months = z
  .literal("")
  .or(z.string().regex(/^\d{1,3}$/, "Ay bilgisi sayı olmalı."))
  .transform((v) => (v === "" ? null : Number(v)));
const checked = z
  .literal("on")
  .optional()
  .transform((v) => v === "on");

const price = str.transform((value, ctx) => {
  const kurus = parsePrice(value);
  if (kurus === null || kurus < 1 || kurus > 100_000_000) {
    ctx.addIssue("Fiyatı 249,90 biçiminde yazın.");
    return z.NEVER;
  }
  return kurus;
});
const optionalPrice = z
  .literal("")
  .transform(() => null)
  .or(price);
const sku = str
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9]$/,
    "SKU 3-40 karakter olmalı; yalnızca harf (Türkçe harfsiz), rakam ve tire.",
  );
const barcode = z
  .literal("")
  .or(str.regex(/^[0-9A-Za-z-]{4,32}$/, "Barkod biçimi geçersiz."))
  .transform((v) => v || null);

const categorySchema = z.object({
  name: text("Ad", 80),
  slug: slugFrom(100),
  parent_id: optionalId,
  sort_order: sortOrder,
  is_active: checked,
});
const brandSchema = z.object({ name: text("Ad", 80), slug: slugFrom(100) });
const colorSchema = z.object({
  name: text("Ad", 40),
  slug: slugFrom(100),
  hex: str.toLowerCase().regex(/^#[0-9a-f]{6}$/, "Renk kodu geçersiz."),
  code: str
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "Kod en fazla 6 harf veya rakam olmalı."),
});
const sizeSchema = z.object({
  name: text("Ad", 40),
  size_group: z.enum(keysOf(sizeGroupLabels), "Beden grubu seçin."),
  code: str
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,8}$/, "Kod en fazla 8 harf, rakam veya tire olmalı."),
  age_min_months: months,
  age_max_months: months,
  sort_order: sortOrder,
});
const sizeChartSchema = z.object({
  name: text("Ad", 80),
  category_id: optionalId,
  rows: str
    .min(1, "Tabloyu yazın.")
    .max(5000, "Tablo çok uzun.")
    .transform(parseRows),
});
const productSchema = z.object({
  name: text("Ad", 150).min(2, "Ad en az 2 karakter olmalı."),
  slug: slugFrom(160),
  product_type: z.enum(keysOf(productTypeLabels), "Tür seçin."),
  audience: z.enum(keysOf(audienceLabels), "Kime seçin."),
  gender: z.enum(keysOf(genderLabels), "Cinsiyet seçin."),
  brand_id: optionalId,
  description: str.max(10_000, "Açıklama çok uzun."),
  material: str.max(500, "Malzeme çok uzun."),
  care: str.max(1000, "Bakım bilgisi çok uzun.").transform((v) => v || null),
  vat_bps: str
    .regex(/^\d{1,3}([.,]\d{1,2})?$/, "KDV oranını yazın.")
    .transform((v) => Math.round(Number(v.replace(",", ".")) * 100))
    .refine((v) => v <= 10_000, "KDV oranı %100'ü aşamaz."),
});

// ---------------------------------------------------------------------------
// Ortak işler
// ---------------------------------------------------------------------------

const INVALID: CatalogState = { error: "Geçersiz istek." };

const firstIssues = (error: z.ZodError): CatalogState => ({
  error: [...new Set(error.issues.map((i) => i.message))].join(" "),
});

const uniqueMessages: Record<string, string> = {
  product_variants_sku_key: "Bu SKU başka bir varyantta kullanılıyor.",
  product_variants_barcode_key: "Bu barkod başka bir varyantta kullanılıyor.",
  product_variants_product_id_color_id_size_id_key:
    "Bu renk ve beden zaten ekli.",
};

function failure(
  error: Pick<PostgrestError, "code" | "message">,
): CatalogState {
  switch (error.code) {
    case "23505": {
      const name = /constraint "(\w+)"/.exec(error.message)?.[1] ?? "";
      return {
        error:
          uniqueMessages[name] ??
          "Aynı ad, adres veya kodla başka bir kayıt var.",
      };
    }
    case "23503":
      return { error: "Kayıt kullanımda olduğu için bu işlem yapılamaz." };
    case "23514":
      return { error: "Girilen değerlerden biri kurallara uymuyor." };
  }
  // Bu kodlardaki Türkçe açıklamaları kendi fonksiyonlarımız yazar.
  if (
    ["42501", "22023", "P0002"].includes(error.code) &&
    !/permission denied|row-level security/.test(error.message)
  ) {
    return { error: error.message };
  }
  console.error("Katalog işlemi başarısız:", error.code);
  return { error: "İşlem yapılamadı. Biraz sonra yeniden deneyin." };
}

/** Adres boşsa addan üretilir; yazıldıysa da güvenli biçime çevrilir. */
const withSlug = <T extends { name: string; slug: string }>(row: T) => ({
  ...row,
  slug: slugify(row.slug || row.name),
});

const refresh = () => revalidatePath("/yonetim/katalog", "layout");

/** `id` varsa günceller, yoksa ekler. RLS engellerse hiçbir satır dönmez. */
async function save(
  table: string,
  rowId: string | null,
  row: Record<string, unknown>,
): Promise<CatalogState> {
  const supabase = await createClient();
  const request = rowId
    ? supabase.from(table).update(row).eq("id", rowId)
    : supabase.from(table).insert(row);
  const { data, error } = await request.select("id");
  if (error) return failure(error);
  if (data.length === 0) return { error: "Kayıt bulunamadı." };
  refresh();
  return { ok: rowId ? "Kaydedildi." : "Eklendi." };
}

/** Seçim listesi kaydı için ekleme/güncelleme işlemi. */
async function saveListItem(
  table: string,
  schema: z.ZodType<Record<string, unknown>>,
  form: FormData,
): Promise<CatalogState> {
  await requirePermission("catalog.write");
  const input = schema.safeParse(Object.fromEntries(form));
  const rowId = optionalId.safeParse(form.get("id") ?? "");
  if (!rowId.success) return INVALID;
  if (!input.success) return firstIssues(input.error);
  return save(table, rowId.data, input.data);
}

// ---------------------------------------------------------------------------
// Seçim listeleri
// ---------------------------------------------------------------------------

export const saveCategory: Action = async (_, form) =>
  saveListItem("categories", categorySchema.transform(withSlug), form);

export const saveBrand: Action = async (_, form) =>
  saveListItem("brands", brandSchema.transform(withSlug), form);

export const saveColor: Action = async (_, form) =>
  saveListItem("colors", colorSchema.transform(withSlug), form);

export const saveSize: Action = async (_, form) =>
  saveListItem("sizes", sizeSchema, form);

export const saveSizeChart: Action = async (_, form) =>
  saveListItem("size_charts", sizeChartSchema, form);

export const deleteListItem: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const input = z
    .object({
      table: z.enum(["categories", "brands", "colors", "sizes", "size_charts"]),
      id,
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(input.data.table)
    .delete()
    .eq("id", input.data.id)
    .select("id");
  if (error) return failure(error);
  if (data.length === 0) return { error: "Kayıt bulunamadı." };
  refresh();
  return { ok: "Silindi." };
};

// ---------------------------------------------------------------------------
// Ürün
// ---------------------------------------------------------------------------

export const createProduct: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const input = productSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert(withSlug(input.data))
    .select("id")
    .single();
  if (error) return failure(error);
  refresh();
  redirect(`/yonetim/katalog/${data.id}`);
};

export const updateProduct: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const rowId = id.safeParse(form.get("id"));
  if (!rowId.success) return INVALID;
  const input = productSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);
  return save("products", rowId.data, withSlug(input.data));
};

async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return failure(error);
  refresh();
  return { ok };
}

export const setCategories: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const input = z
    .object({ id, primary: optionalId, others: z.array(id).max(50) })
    .safeParse({
      id: form.get("id"),
      primary: form.get("primary"),
      others: form.getAll("others"),
    });
  if (!input.success) return INVALID;
  return rpc(
    "set_product_categories",
    {
      p_product: input.data.id,
      p_primary: input.data.primary,
      p_others: input.data.others,
    },
    "Kategoriler kaydedildi.",
  );
};

export const setStatus: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const input = z
    .object({ id, status: z.enum(keysOf(statusLabels)) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return INVALID;
  return rpc(
    "set_product_status",
    { p_product: input.data.id, p_status: input.data.status },
    "Durum değişti.",
  );
};

// ---------------------------------------------------------------------------
// Varyant
// ---------------------------------------------------------------------------

/** Seçilen renk ve bedenler tek istekte eklenir: ya hepsi ya hiçbiri. */
export const createVariants: Action = async (_, form) => {
  await requirePermission("catalog.write");
  await requirePermission("prices.write");
  const input = z
    .object({
      product: id,
      price,
      rows: z
        .array(
          z.object({
            color_id: optionalId,
            size_id: optionalId,
            sku,
            barcode,
          }),
        )
        .min(1, "En az bir renk ve beden seçin.")
        .max(200, "Bir seferde en fazla 200 varyant eklenebilir."),
    })
    .safeParse({
      product: form.get("product"),
      price: form.get("price"),
      rows: form.getAll("sku").map((value, i) => ({
        sku: value,
        color_id: form.getAll("color")[i],
        size_id: form.getAll("size")[i],
        barcode: form.getAll("barcode")[i],
      })),
    });
  if (!input.success) return firstIssues(input.error);

  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").insert(
    input.data.rows.map((row) => ({
      ...row,
      product_id: input.data.product,
      price: input.data.price,
    })),
  );
  if (error) return failure(error);
  refresh();
  return { ok: `${input.data.rows.length} varyant eklendi.` };
};

export const updateVariant: Action = async (_, form) => {
  const access = await requirePermission("catalog.write");
  const rowId = id.safeParse(form.get("id"));
  if (!rowId.success) return INVALID;
  const base = z.object({
    sku,
    barcode,
    desi: z
      .literal("")
      .transform(() => null)
      .or(
        str
          .regex(/^\d{1,4}([.,]\d{1,2})?$/, "Desiyi 1,5 biçiminde yazın.")
          .transform((v) => Number(v.replace(",", "."))),
      ),
    is_active: checked,
  });
  const schema = access.permissions.includes("prices.write")
    ? base.extend({ price, compare_at_price: optionalPrice })
    : base;
  const input = schema.safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);
  return save("product_variants", rowId.data, input.data);
};

export const saveCost: Action = async (_, form) => {
  await requirePermission("costs.write");
  const input = z
    .object({ id, cost: price })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("variant_costs")
    .update({ cost: input.data.cost })
    .eq("variant_id", input.data.id)
    .select("variant_id");
  if (error) return failure(error);
  if (data.length === 0) {
    const { error: insertError } = await supabase
      .from("variant_costs")
      .insert({ variant_id: input.data.id, cost: input.data.cost });
    if (insertError) return failure(insertError);
  }
  refresh();
  return { ok: "Maliyet kaydedildi." };
};

// ---------------------------------------------------------------------------
// Görsel
// ---------------------------------------------------------------------------

const imageSchema = z.object({
  color_id: optionalId,
  alt: text("Görsel açıklaması", 200),
});

export const uploadImage: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const product = id.safeParse(form.get("product"));
  const file = form.get("file");
  if (!product.success || !(file instanceof File)) return INVALID;
  const input = imageSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);

  let image;
  try {
    image = await processImage(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImageError) return { error: error.message };
    throw error;
  }

  const supabase = await createClient();
  const { data: last, error: lastError } = await supabase
    .from("product_images")
    .select("sort_order")
    .eq("product_id", product.data)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) return failure(lastError);

  // Dosya adı tarayıcıdan gelmez, burada rastgele üretilir.
  const path = `${randomUUID()}.webp`;
  const bucket = supabase.storage.from(BUCKET);
  const { error: uploadError } = await bucket.upload(path, image.data, {
    contentType: "image/webp",
  });
  if (uploadError) {
    console.error("Görsel yüklenemedi:", uploadError.name);
    return { error: "Görsel yüklenemedi. Biraz sonra yeniden deneyin." };
  }

  const result = await save("product_images", null, {
    ...input.data,
    product_id: product.data,
    path,
    width: image.width,
    height: image.height,
    sort_order: (last[0]?.sort_order ?? 0) + 10,
  });
  if (result.error) await bucket.remove([path]);
  return result.error ? result : { ok: "Görsel yüklendi." };
};

export const updateImage: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const rowId = id.safeParse(form.get("id"));
  if (!rowId.success) return INVALID;
  const input = imageSchema
    .extend({ sort_order: sortOrder })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return firstIssues(input.error);
  return save("product_images", rowId.data, input.data);
};

/** Önce kayıt silinir: yayındaki ürünün son görseliyse veritabanı izin vermez. */
export const deleteImage: Action = async (_, form) => {
  await requirePermission("catalog.write");
  const rowId = id.safeParse(form.get("id"));
  if (!rowId.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_images")
    .delete()
    .eq("id", rowId.data)
    .select("path");
  if (error) return failure(error);
  if (data.length === 0) return { error: "Kayıt bulunamadı." };
  const { error: removeError } = await supabase.storage
    .from(BUCKET)
    .remove(data.map((d) => d.path as string));
  if (removeError) {
    console.error("Görsel dosyası silinemedi:", removeError.name);
  }
  refresh();
  return { ok: "Görsel silindi." };
};
