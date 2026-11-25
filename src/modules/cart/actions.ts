"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient, hasSessionCookie } from "@/lib/supabase";
import { guestToken, keepGuestToken, mergeGuestCart } from "./guest";

export type CartState = { ok?: string; error?: string; removed?: boolean };

/** Kimin sepeti olduğuna ve bütün sınırlara veritabanı karar verir. */
async function call(
  fn: "cart_add" | "cart_set",
  args: Record<string, unknown>,
) {
  const supabase = await createClient();
  // Girişte birleşememiş sepet varsa burada yeniden denenir.
  if (await hasSessionCookie()) await mergeGuestCart(supabase);

  const token = await guestToken();
  const { data, error } = await supabase.rpc(fn, { p_token: token, ...args });
  // Hatada da sayfa yenilenir: stok veya fiyat değişmiş olabilir.
  revalidatePath("/", "layout");
  if (error) return dbErrorMessage(error);

  // Yeni misafire kod verilir; eski kodun süresi yenilenir.
  const created = z.object({ token: z.string().nullable() }).safeParse(data);
  const keep = created.data?.token ?? token;
  if (keep) await keepGuestToken(keep);
}

export async function addToCart(
  _: CartState,
  form: FormData,
): Promise<CartState> {
  const variant = z.uuid().safeParse(form.get("variant"));
  if (!variant.success) return { error: "Önce beden seçin." };

  const error = await call("cart_add", { p_variant: variant.data });
  return error ? { error } : { ok: "Sepete eklendi." };
}

export async function setCartQuantity(
  _: CartState,
  form: FormData,
): Promise<CartState> {
  const input = z
    .object({
      variant: z.uuid(),
      quantity: z
        .string()
        .regex(/^(\d|10)$/)
        .transform(Number),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Geçersiz istek." };

  const { variant, quantity } = input.data;
  const error = await call("cart_set", {
    p_variant: variant,
    p_quantity: quantity,
  });
  if (error) return { error };
  return quantity === 0
    ? { ok: "Ürün sepetten kaldırıldı.", removed: true }
    : { ok: `Adet ${quantity} oldu.` };
}
