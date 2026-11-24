"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import { mapColumns, permissionFor } from "./columns";
import { lookupKeys, planProducts, planStock } from "./plan";
import { getImport, getImportLists, lookup } from "./queries";
import { MAX_FILE_BYTES, readXlsx, XlsxError, type SheetRow } from "./xlsx";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;

const INVALID: PanelState = { error: "Geçersiz istek." };

const uploadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("products"), file: z.instanceof(File) }),
  z.object({
    kind: z.literal("stock"),
    mode: z.enum(["purchase", "adjustment"], "Sayının anlamını seçin."),
    file: z.instanceof(File),
  }),
]);

/** Dosyayı okur, planlar ve planı saklar. Ürün ve stok kayıtlarına dokunmaz. */
export const uploadImport: Action = async (_, form) => {
  const kind = z.enum(["products", "stock"]).safeParse(form.get("kind"));
  if (!kind.success) return INVALID;
  await requirePermission(permissionFor(kind.data));
  const input = uploadSchema.safeParse(Object.fromEntries(form));
  if (!input.success) {
    return { error: input.error.issues[0].message };
  }
  const { file } = input.data;
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Dosya en fazla 2 MB olabilir." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheet: SheetRow[];
  try {
    sheet = readXlsx(bytes);
  } catch (error) {
    if (error instanceof XlsxError) return { error: error.message };
    throw error;
  }
  const mapped = mapColumns(input.data.kind, sheet);
  if ("error" in mapped) return { error: mapped.error };

  const existing = await lookup(lookupKeys(mapped.rows));
  const rows =
    input.data.kind === "products"
      ? planProducts(mapped.rows, await getImportLists(), existing)
      : planStock(mapped.rows, input.data.mode, existing);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_import", {
    p_kind: input.data.kind,
    p_stock_mode: input.data.kind === "stock" ? input.data.mode : null,
    p_file_name:
      file.name
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 200) || "adsız.xlsx",
    p_file_hash: createHash("sha256").update(bytes).digest("hex"),
    p_rows: rows,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/yonetim/excel");
  redirect(`/yonetim/excel/${data}`);
};

/** Bütün kontrolleri ve yazmayı tek işlemde veritabanı yapar. */
export const applyImport: Action = async (_, form) => {
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return INVALID;
  const job = await getImport(id.data);
  if (!job) return { error: "Yükleme bulunamadı." };
  await requirePermission(permissionFor(job.kind));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_import", {
    p_job: id.data,
    p_confirm_prices: form.get("prices") === "on",
    p_confirm_repeat: form.get("repeat") === "on",
  });
  revalidatePath("/yonetim", "layout");
  if (error) {
    return {
      error: dbErrorMessage(error, {
        product_variants_sku_key:
          "Bir SKU bu sırada başka bir varyanta verilmiş. Dosyayı yeniden yükleyin.",
        product_variants_barcode_key:
          "Bir barkod bu sırada başka bir varyanta verilmiş. Dosyayı yeniden yükleyin.",
        product_variants_product_id_color_id_size_id_key:
          "Bir renk ve beden bu sırada eklenmiş. Dosyayı yeniden yükleyin.",
      }),
    };
  }
  return { ok: `${data} satır uygulandı.` };
};
