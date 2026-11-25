import "server-only";
import { cache } from "react";
import { z } from "zod";
import { createClient, hasSessionCookie } from "@/lib/supabase";
import { guestToken } from "./guest";

const itemSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("gone"),
    variant_id: z.string(),
    quantity: z.number(),
  }),
  z.object({
    state: z.enum(["ok", "short", "out"]),
    variant_id: z.string(),
    quantity: z.number(),
    name: z.string(),
    slug: z.string(),
    color: z.string().nullable(),
    size: z.string().nullable(),
    price: z.number(),
    image_path: z.string().nullable(),
    image_alt: z.string().nullable(),
  }),
]);

const cartSchema = z.object({
  subtotal: z.number(),
  items: z.array(itemSchema),
});

export type Cart = z.infer<typeof cartSchema>;
export type CartItem = Cart["items"][number];

/** Sepeti olamayacak ziyaretçi için veritabanına gidilmez. */
async function readCart(fn: "cart_get" | "cart_count") {
  const token = await guestToken();
  if (!token && !(await hasSessionCookie())) return null;
  const supabase = await createClient();
  return supabase.rpc(fn, { p_token: token });
}

export async function getCart(): Promise<Cart> {
  const result = await readCart("cart_get");
  if (!result) return { subtotal: 0, items: [] };
  if (result.error) throw new Error(`Sepet okunamadı: ${result.error.code}`);
  return cartSchema.parse(result.data);
}

/** Menüdeki adet. Okunamazsa mağaza yine açılır. */
export const getCartCount = cache(async () => {
  const result = await readCart("cart_count");
  if (!result) return 0;
  if (result.error) {
    console.error("Sepet adedi okunamadı:", result.error.code);
    return 0;
  }
  return z.number().parse(result.data);
});
