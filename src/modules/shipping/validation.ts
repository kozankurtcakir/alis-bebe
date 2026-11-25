import { z } from "zod";
import { transferSchema } from "@/modules/orders/validation";

const INVALID = "Geçersiz istek.";

// Veritabanındaki kuralla aynı; alan adına takip numarası yazılamaz.
const URL_TEMPLATE =
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/[^\s<>"'\{}]*\{no\}[^\s<>"'\{}]*$/;

export const carrierSchema = z.object({
  id: z.union([z.literal("").transform(() => null), z.uuid(INVALID)], INVALID),
  name: z
    .string(INVALID)
    .trim()
    .min(2, "Firma adı en az 2 karakter olmalı.")
    .max(60, "Firma adı en fazla 60 karakter olabilir."),
  url: z
    .string(INVALID)
    .trim()
    .max(300, "Takip adresi çok uzun.")
    .refine(
      (v) => v === "" || URL_TEMPLATE.test(v),
      "Takip adresi https:// ile başlamalı ve {no} içermeli.",
    ),
  active: z
    .literal("on", INVALID)
    .optional()
    .transform((v) => v === "on"),
});

export const trackingSchema = z.object({
  id: z.uuid(INVALID),
  carrier: z.uuid("Kargo firmasını seçin."),
  tracking: z
    .string(INVALID)
    .transform((v) =>
      v.replace(/\s/g, "").replace(/[a-z]/g, (c) => c.toUpperCase()),
    )
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z0-9-]{5,40}$/,
          "Takip numarası 5-40 harf veya rakam olmalı.",
        ),
    ),
});

/** Yanlış kayıt silinmez; eksi tutarla düzeltilir. */
export const codSchema = transferSchema
  .extend({ kind: z.enum(["in", "fix"], "Kayıt türünü seçin.") })
  .transform(({ kind, amount, ...rest }) => ({
    ...rest,
    amount: kind === "fix" ? -amount : amount,
  }));
