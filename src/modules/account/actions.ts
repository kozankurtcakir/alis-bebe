"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient } from "@/lib/supabase";
import { requireUser } from "@/modules/auth/access";
import { addressSchema, consentSchema, profileSchema } from "./validation";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;

const failed = (error: z.ZodError): PanelState => ({
  error: [...new Set(error.issues.map((i) => i.message))].join(" "),
});

type Db = Awaited<ReturnType<typeof createClient>>;

async function finish(
  ok: string,
  run: (supabase: Db) => PromiseLike<{
    error: { code: string; message: string } | null;
  }>,
): Promise<PanelState> {
  const { error } = await run(await createClient());
  revalidatePath("/hesap", "layout");
  return error ? { error: dbErrorMessage(error) } : { ok };
}

export const saveProfile: Action = async (_, form) => {
  const { userId } = await requireUser();
  const input = profileSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);

  return finish("Bilgileriniz kaydedildi.", (supabase) =>
    supabase.from("profiles").update(input.data).eq("id", userId),
  );
};

export const saveAddress: Action = async (_, form) => {
  await requireUser();
  const input = addressSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);

  const a = input.data;
  return finish("Adres kaydedildi.", (supabase) =>
    supabase.rpc("save_address", {
      p_id: a.id,
      p_title: a.title,
      p_recipient: a.recipient,
      p_phone: a.phone,
      p_city: a.city,
      p_district: a.district,
      p_line: a.line,
      p_postal_code: a.postal_code,
      p_default: a.is_default,
    }),
  );
};

export const deleteAddress: Action = async (_, form) => {
  await requireUser();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Geçersiz istek." };

  return finish("Adres silindi.", (supabase) =>
    supabase.rpc("delete_address", { p_id: id.data }),
  );
};

export const setConsent: Action = async (_, form) => {
  await requireUser();
  const input = consentSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Geçersiz istek." };

  const { kind, granted } = input.data;
  return finish(granted ? "İzin verildi." : "İzin kaldırıldı.", (supabase) =>
    supabase.rpc("set_consent", { p_kind: kind, p_granted: granted }),
  );
};
