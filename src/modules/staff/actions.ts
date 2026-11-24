"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import { emailSchema } from "@/modules/auth/validation";
import { staffRoles } from "./labels";

export type StaffState = { ok?: string; error?: string };

const role = z.enum(staffRoles);
const user = z.uuid();

/** Son kararı veritabanı fonksiyonu verir; buradaki kontroller ilk savunmadır. */
async function run(
  fn: string,
  args: Record<string, unknown>,
  ok: string,
): Promise<StaffState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    // Bu kodlardaki Türkçe açıklamaları kendi fonksiyonlarımız yazar.
    const known = ["42501", "22023", "P0002"].includes(error.code);
    return {
      error:
        known && !error.message.startsWith("permission denied")
          ? error.message
          : "İşlem yapılamadı. Biraz sonra yeniden deneyin.",
    };
  }
  revalidatePath("/yonetim/personel");
  return { ok };
}

const INVALID: StaffState = { error: "Geçersiz istek." };

export async function addStaff(
  _: StaffState,
  form: FormData,
): Promise<StaffState> {
  await requirePermission("staff.manage");
  const email = emailSchema.safeParse({ email: form.get("email") });
  if (!email.success) return { error: "Geçerli bir e-posta yazın." };
  const parsedRole = role.safeParse(form.get("role"));
  if (!parsedRole.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("find_user_by_email", { p_email: email.data.email })
    .maybeSingle<{ id: string }>();
  if (error) return { error: "Kullanıcı aranamadı." };
  if (!data) return { error: "Bu e-postayla üye bulunamadı." };

  return run(
    "assign_role",
    { p_user: data.id, p_role: parsedRole.data },
    "Rol verildi.",
  );
}

export async function assignRole(_: StaffState, form: FormData) {
  await requirePermission("staff.manage");
  const input = z
    .object({ user, role })
    .safeParse({ user: form.get("user"), role: form.get("role") });
  if (!input.success) return INVALID;
  return run(
    "assign_role",
    { p_user: input.data.user, p_role: input.data.role },
    "Rol verildi.",
  );
}

export async function revokeRole(_: StaffState, form: FormData) {
  await requirePermission("staff.manage");
  const input = z
    .object({ user, role })
    .safeParse({ user: form.get("user"), role: form.get("role") });
  if (!input.success) return INVALID;
  return run(
    "revoke_role",
    { p_user: input.data.user, p_role: input.data.role },
    "Rol kaldırıldı.",
  );
}

export async function setActive(_: StaffState, form: FormData) {
  await requirePermission("staff.manage");
  const input = z
    .object({ user, active: z.enum(["true", "false"]) })
    .safeParse({ user: form.get("user"), active: form.get("active") });
  if (!input.success) return INVALID;
  return run(
    "set_user_active",
    { p_user: input.data.user, p_active: input.data.active === "true" },
    "Hesap durumu değişti.",
  );
}

export async function resetMfa(_: StaffState, form: FormData) {
  await requirePermission("roles.manage");
  const input = user.safeParse(form.get("user"));
  if (!input.success) return INVALID;
  return run("reset_mfa", { p_user: input.data }, "Doğrulama sıfırlandı.");
}
