import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const carrier = z.object({
  id: z.string(),
  name: z.string(),
  url_template: z.string().nullable(),
  is_active: z.boolean(),
});
export type Carrier = z.infer<typeof carrier>;

/** RLS firmaları yalnızca kargo izni olan personele gösterir. */
export async function listCarriers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carriers")
    .select("id, name, url_template, is_active")
    .order("name");
  if (error) throw new Error(`Kargo firmaları okunamadı: ${error.code}`);
  return z.array(carrier).parse(data);
}
