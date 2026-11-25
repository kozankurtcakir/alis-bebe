import "server-only";
import { z } from "zod";
import { createClient, hasSessionCookie } from "@/lib/supabase";
import { cardSchema } from "@/modules/shop/queries";

/** Ürün kişinin favorisi mi? Giriş yapılmadıysa null. */
export async function getFavorite(slug: string) {
  if (!(await hasSessionCookie())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_favorite", { p_slug: slug });
  // Oturum bu arada bittiyse ziyaretçi sayılır; ürün sayfası yine açılır.
  return error ? null : z.boolean().nullable().parse(data);
}

export async function listFavorites() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_favorites");
  if (error) throw new Error(`Favoriler okunamadı: ${error.code}`);
  return z.array(cardSchema).parse(data);
}
