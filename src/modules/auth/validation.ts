import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-posta çok uzun.")
  .pipe(z.email("Geçerli bir e-posta yazın."));

// Supabase ayarıyla aynı kural (supabase/config.jsonc); 72 bayt bcrypt sınırıdır.
const newPassword = z
  .string()
  .min(10, "Şifre en az 10 karakter olmalı.")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Şifre çok uzun.")
  .regex(/[A-Za-z]/, "Şifrede en az bir harf (a-z) olmalı.")
  .regex(/[0-9]/, "Şifrede en az bir rakam olmalı.");

export const signUpSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Adınızı ve soyadınızı yazın.")
    .max(100, "Ad çok uzun."),
  email,
  password: newPassword,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Şifrenizi yazın.").max(200, "Şifre çok uzun."),
});

export const emailSchema = z.object({ email });

export const newPasswordSchema = z.object({ password: newPassword });

export const codeSchema = z.object({
  code: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .pipe(z.string().regex(/^[0-9]{6}$/, "Uygulamadaki 6 haneli kodu yazın.")),
});

export const emailLinkSchema = z.object({
  token_hash: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  type: z.enum(["email", "recovery"]),
});
