"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import { manualReasons } from "./labels";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;

const INVALID: PanelState = { error: "Geçersiz istek." };

const id = z.uuid("Geçersiz istek.");
const count = z
  .string("Geçersiz istek.")
  .trim()
  .regex(/^\d{1,6}$/, "Miktarı tam sayı olarak yazın.")
  .transform(Number);
const note = z.string("Geçersiz istek.").trim().max(500, "Not çok uzun.");

const failed = (error: z.ZodError): PanelState => ({
  error: [...new Set(error.issues.map((i) => i.message))].join(" "),
});

/** Son kararı veritabanı fonksiyonu verir. Hatada da sayfa yenilenir: stok değişmiş olabilir. */
async function call(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  revalidatePath("/yonetim", "layout");
  return {
    stock: data as number | null,
    error: error && dbErrorMessage(error),
  };
}

export const adjustStock: Action = async (_, form) => {
  await requirePermission("stock.adjust");
  const input = z
    .object({
      id,
      key: id,
      reason: z.enum(manualReasons),
      quantity: count,
      note,
      expected: z.literal("").or(count).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);

  const { reason, expected } = input.data;
  const { stock, error } = await call("adjust_stock", {
    p_variant: input.data.id,
    p_reason: reason,
    p_quantity: input.data.quantity,
    p_note: input.data.note,
    p_key: input.data.key,
    p_expected: typeof expected === "number" ? expected : null,
  });
  if (error) return { error };
  if (reason === "adjustment" && stock === expected) {
    return { ok: "Sayım stokla aynı; kayıt oluşturulmadı." };
  }
  return { ok: `Kaydedildi. Yeni stok: ${stock}` };
};

export const reverseMovement: Action = async (_, form) => {
  await requirePermission("stock.adjust");
  const input = z
    .object({ id, key: id, note: note.min(1, "Nedenini yazın.") })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { error } = await call("reverse_stock_movement", {
    p_movement: input.data.id,
    p_note: input.data.note,
    p_key: input.data.key,
  });
  return error ? { error } : { ok: "Ters kayıt oluşturuldu." };
};

export const setCriticalLevel: Action = async (_, form) => {
  await requirePermission("stock.adjust");
  const input = z
    .object({ id, level: count })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return INVALID;
  const { error } = await call("set_critical_level", {
    p_variant: input.data.id,
    p_level: input.data.level,
  });
  return error ? { error } : { ok: "Kritik seviye kaydedildi." };
};
