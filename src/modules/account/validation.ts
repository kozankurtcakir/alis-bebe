import { z } from "zod";
import { cities } from "./cities";

/** "0555 000 00 00", "+90 555…" → "+905550000000". Cep telefonu değilse null. */
export function parsePhone(text: string) {
  const digits = text.replace(/[\s().-]/g, "");
  const match = /^(?:\+90|0090|90|0)?(5\d{9})$/.exec(digits);
  return match ? `+90${match[1]}` : null;
}

/** "+905550000000" → "0555 000 00 00" */
export const formatPhone = (phone: string) =>
  phone.replace(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/, "0$1 $2 $3 $4");

const text = (label: string, min: number, max: number) =>
  z
    .string("Geçersiz istek.")
    // Satır sonu ve görünmeyen karakterler boşluğa döner.
    .transform((v) => v.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, `${label} en az ${min} karakter olmalı.`)
        .max(max, `${label} en fazla ${max} karakter olabilir.`),
    );

const PHONE = "Geçerli bir cep telefonu yazın. Örnek: 0555 000 00 00";

const mobile = z
  .string("Geçersiz istek.")
  .max(30, PHONE)
  .transform((v, ctx) => {
    const phone = parsePhone(v);
    if (phone) return phone;
    ctx.addIssue(PHONE);
    return z.NEVER;
  });

const blank = z
  .string("Geçersiz istek.")
  .trim()
  .length(0)
  .transform(() => null);

export const profileSchema = z.object({
  full_name: text("Ad soyad", 2, 100),
  phone: z.union([blank, mobile], PHONE),
});

const POSTAL = "Posta kodu 5 rakam olmalı.";

export const addressSchema = z.object({
  id: z.union([blank, z.uuid("Geçersiz istek.")], "Geçersiz istek."),
  title: text("Adres adı", 1, 40),
  recipient: text("Alıcı", 2, 100),
  phone: mobile,
  city: z.enum(cities, "İl seçin."),
  district: text("İlçe", 2, 60),
  line: text("Açık adres", 10, 300),
  postal_code: z.union(
    [
      blank,
      z
        .string()
        .trim()
        .regex(/^\d{5}$/, POSTAL),
    ],
    POSTAL,
  ),
  is_default: z
    .literal("on", "Geçersiz istek.")
    .optional()
    .transform((v) => v === "on"),
});

export const consentKinds = {
  email_marketing: "E-posta",
  sms_marketing: "SMS",
} as const;
export type ConsentKind = keyof typeof consentKinds;

export const consentSchema = z.object({
  kind: z.enum(Object.keys(consentKinds) as ConsentKind[]),
  granted: z.enum(["true", "false"]).transform((v) => v === "true"),
});
