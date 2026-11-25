import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cookieOptions } from "@/lib/env";

// Misafir sepetinin kodu. Veritabanında yalnızca özeti durur.
const COOKIE = "sepet";
const MAX_AGE = 30 * 24 * 60 * 60; // Veritabanındaki 30 gün ile aynı.

export async function guestToken() {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export const keepGuestToken = async (token: string) =>
  (await cookies()).set(COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE });

/** Girişten sonra çağrılır. Hata girişi engellemez; çerez kalır, sonra yeniden denenir. */
export async function mergeGuestCart(supabase: SupabaseClient) {
  const token = await guestToken();
  if (!token) return;
  const { error } = await supabase.rpc("cart_merge", { p_token: token });
  if (error) console.error("Sepet birleştirilemedi:", error.code);
  else (await cookies()).delete(COOKIE);
}
