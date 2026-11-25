import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { consentKinds, type ConsentKind } from "./validation";

// RLS kişiyi yalnızca kendi satırlarına ulaştırır.

export async function getProfile() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .single();
  if (error) throw new Error(`Profil okunamadı: ${error.code}`);
  return z
    .object({ full_name: z.string(), phone: z.string().nullable() })
    .parse(data);
}

const addressRow = z.object({
  id: z.string(),
  title: z.string(),
  recipient: z.string(),
  phone: z.string(),
  city: z.string(),
  district: z.string(),
  line: z.string(),
  postal_code: z.string().nullable(),
  is_default: z.boolean(),
});

export type Address = z.infer<typeof addressRow>;

export async function listAddresses() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addresses")
    .select(
      "id, title, recipient, phone, city, district, line, postal_code, is_default",
    )
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Adresler okunamadı: ${error.code}`);
  return z.array(addressRow).parse(data);
}

/** Her tür için geçerli olan son kayıt; hiç yoksa izin yoktur. */
export async function listConsents() {
  const supabase = await createClient();
  const kinds = Object.keys(consentKinds) as ConsentKind[];
  return Promise.all(
    kinds.map(async (kind) => {
      const { data, error } = await supabase
        .from("consents")
        .select("granted, at")
        .eq("kind", kind)
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`İzinler okunamadı: ${error.code}`);
      const row = z
        .object({ granted: z.boolean(), at: z.string() })
        .nullable()
        .parse(data);
      return { kind, granted: row?.granted ?? false, at: row?.at ?? null };
    }),
  );
}
