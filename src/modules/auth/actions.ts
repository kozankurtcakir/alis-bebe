"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase";
import { requireUser } from "./access";
import {
  codeSchema,
  emailLinkSchema,
  emailSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./validation";

export type FormState = {
  ok?: string;
  error?: string;
  errors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
};

const TRY_LATER = "İşlem yapılamadı. Biraz sonra yeniden deneyin.";

function parse<T extends z.ZodType>(schema: T, form: FormData) {
  const raw = Object.fromEntries(form);
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };

  // Şifre ve kod geri gönderilmez.
  const values: Record<string, string> = {};
  for (const key of ["email", "full_name"]) {
    if (typeof raw[key] === "string") values[key] = raw[key];
  }
  const state: FormState = {
    errors: z.flattenError(result.error).fieldErrors,
    values,
  };
  return { state };
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const { data, state } = parse(signUpSchema, form);
  if (!data) return state;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: { full_name: data.full_name },
      emailRedirectTo: `${env().SITE_URL}/onay`,
    },
  });
  if (error?.code === "weak_password") {
    return { errors: { password: ["Daha güçlü bir şifre seçin."] } };
  }
  // E-posta kayıtlı olsa da aynı cevap verilir; kimin üye olduğu anlaşılmaz.
  if (error && error.code !== "user_already_exists") {
    return { error: TRY_LATER };
  }
  return { ok: "E-postanıza doğrulama bağlantısı gönderdik." };
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const { data, state } = parse(signInSchema, form);
  if (!data) return state;
  const values = { email: data.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(data);
  if (error?.code === "email_not_confirmed") {
    return { error: "Önce e-posta adresinizi doğrulayın.", values };
  }
  if (error?.code === "invalid_credentials") {
    return { error: "E-posta veya şifre hatalı.", values };
  }
  if (error) return { error: TRY_LATER, values };

  const { data: access, error: accessError } = await supabase
    .rpc("my_access")
    .single<{ is_active: boolean; is_staff: boolean }>();
  if (accessError || !access.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      error: accessError
        ? TRY_LATER
        : "Hesabınız kullanıma kapalı. Mağazayla iletişime geçin.",
    };
  }
  redirect(access.is_staff ? "/iki-adim" : "/hesap");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/giris");
}

export async function requestPasswordReset(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, state } = parse(emailSchema, form);
  if (!data) return state;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(data.email, {
    redirectTo: `${env().SITE_URL}/onay`,
  });
  return { ok: "Bu e-posta kayıtlıysa yenileme bağlantısı gönderdik." };
}

/** Bağlantı düğmeyle onaylanır; posta tarayıcıları bağlantıyı tek başına harcayamaz. */
export async function confirmEmailLink(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const expired = { error: "Bağlantı geçersiz veya süresi dolmuş." };
  const { data } = parse(emailLinkSchema, form);
  if (!data) return expired;

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp(data);
  if (error) return expired;
  redirect(data.type === "recovery" ? "/sifre-yenile" : "/hesap");
}

export async function updatePassword(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await requireUser();
  const { data, state } = parse(newPasswordSchema, form);
  if (!data) return state;

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: data.password });
  if (error?.code === "insufficient_aal") redirect("/iki-adim?sonra=sifre");
  if (error?.code === "same_password") {
    return { errors: { password: ["Eskisinden farklı bir şifre seçin."] } };
  }
  if (error?.code === "reauthentication_needed") {
    return { error: "Güvenlik için “Şifremi unuttum” adımını kullanın." };
  }
  if (error) return { error: TRY_LATER };

  await supabase.auth.signOut({ scope: "others" });
  redirect("/hesap");
}

export type MfaSetup = FormState & { qr?: string; secret?: string };

export async function startMfaSetup(): Promise<MfaSetup> {
  const access = await requireUser();
  if (!access.isStaff) return { error: TRY_LATER };

  const supabase = await createClient();
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) return { error: TRY_LATER };
  if (factors.totp.length > 0) return { error: "Doğrulama zaten kurulu." };

  // Yarım kalmış kurulumlar temizlenir.
  for (const factor of factors.all) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Alis Bebe",
    friendlyName: "Telefon",
  });
  if (!data) return { error: TRY_LATER };
  return { qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfa(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const access = await requireUser();
  if (!access.isStaff) return { error: TRY_LATER };
  const { data, state } = parse(codeSchema, form);
  if (!data) return state;

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor =
    factors?.totp[0] ?? factors?.all.find((f) => f.factor_type === "totp");
  if (!factor) return { error: "Önce kurulumu başlatın." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: data.code,
  });
  if (error) {
    return { errors: { code: ["Kod hatalı veya süresi dolmuş."] } };
  }
  redirect(form.get("sonra") === "sifre" ? "/sifre-yenile" : "/yonetim");
}
