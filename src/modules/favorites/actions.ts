"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient } from "@/lib/supabase";
import { requireUser } from "@/modules/auth/access";

export type FavoriteState = { error?: string };

export async function setFavorite(
  _: FavoriteState,
  form: FormData,
): Promise<FavoriteState> {
  await requireUser();
  const input = z
    .object({ slug: z.string().min(1).max(200), on: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Geçersiz istek." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_favorite", {
    p_slug: input.data.slug,
    p_on: input.data.on === "true",
  });
  revalidatePath("/", "layout");
  return error ? { error: dbErrorMessage(error) } : {};
}
