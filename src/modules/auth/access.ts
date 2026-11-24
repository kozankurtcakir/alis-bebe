import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const accessSchema = z.object({
  is_active: z.boolean(),
  is_staff: z.boolean(),
  permissions: z.array(z.string()),
});

/** Giriş yapan kişi; oturum yoksa, kapatıldıysa veya hesap pasifse null. */
export const getAccess = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth) return null;

  const { data, error } = await supabase.rpc("my_access").single();
  if (error) throw new Error(`Yetki okunamadı: ${error.code}`);
  const access = accessSchema.parse(data);
  if (!access.is_active) return null;

  return {
    userId: auth.claims.sub,
    email: auth.claims.email ?? "",
    isStaff: access.is_staff,
    hasSecondStep: auth.claims.aal === "aal2",
    permissions: access.permissions,
  };
});

export async function requireUser() {
  return (await getAccess()) ?? redirect("/giris");
}

/** Yönetim paneli: personel olmayan sayfanın varlığını görmez. */
export async function requireStaff() {
  const access = await requireUser();
  if (!access.isStaff) notFound();
  if (!access.hasSecondStep) redirect("/iki-adim");
  return access;
}

export async function requirePermission(permission: string) {
  const access = await requireStaff();
  if (!access.permissions.includes(permission)) notFound();
  return access;
}
