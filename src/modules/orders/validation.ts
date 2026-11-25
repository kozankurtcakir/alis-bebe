import { z } from "zod";
import { parsePrice, priceInput } from "@/lib/money";
import { addressSchema, profileSchema } from "@/modules/account/validation";

const INVALID = "Geçersiz istek.";

const on = z
  .literal("on", INVALID)
  .optional()
  .transform((v) => v === "on");

const place = addressSchema.pick({
  city: true,
  district: true,
  line: true,
  postal_code: true,
});
const person = addressSchema.pick({ recipient: true, phone: true });

const base = z.object({
  key: z.uuid(INVALID),
  name: profileSchema.shape.full_name,
  phone: addressSchema.shape.phone,
  delivery: z.enum(["shipping", "pickup"], "Teslimat yöntemini seçin."),
  payment: z.enum(
    ["card", "transfer", "cod", "store"],
    "Ödeme yöntemini seçin.",
  ),
  gift: on,
  other: on,
  same: on,
  corporate: on,
  expected_total: z
    .string(INVALID)
    .regex(/^\d{1,12}$/, INVALID)
    .transform(Number),
});

const guest = z.object({
  email: z
    .string(INVALID)
    .trim()
    .max(254, "E-posta çok uzun.")
    .pipe(z.email("Geçerli bir e-posta yazın.")),
});

const trimmed = (max: number, message: string) =>
  z.string(INVALID).trim().pipe(z.string().min(2, message).max(max, message));

const company = z.object({
  company: trimmed(200, "Şirket unvanını yazın."),
  tax_office: trimmed(100, "Vergi dairesini yazın."),
  tax_no: z
    .string(INVALID)
    .trim()
    .regex(/^\d{10}$/, "Vergi numarası 10 rakam olmalı."),
});

/** Önekli alanlar: teslimat `d_`, fatura `f_`. */
const prefixed = (form: FormData, prefix: string) =>
  Object.fromEntries(
    [...form]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v]),
  );

/** Ödeme formunu veritabanının beklediği hâle getirir. Kararların hepsi veritabanınındır. */
export function parseCheckout(form: FormData, isGuest: boolean) {
  const problems: string[] = [];
  const read = <T extends z.ZodType>(schema: T, value: unknown, label = "") => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    problems.push(...result.error.issues.map((i) => label + i.message));
  };

  const all = Object.fromEntries(form);
  const b = read(base, all);
  const contact = isGuest ? read(guest, all) : undefined;
  const documents = z
    .array(z.uuid())
    .min(1)
    .safeParse(form.getAll("documents"));
  if (!documents.success) {
    problems.push("Sözleşmeleri okuyup onaylamanız gerekir.");
  }

  if (b) {
    const shipping = b.delivery === "shipping";
    const d = prefixed(form, "d_");
    const address = shipping ? read(place, d, "Teslimat adresi: ") : undefined;
    const receiver =
      shipping && b.other
        ? read(person, d, "Teslim alacak kişi: ")
        : { recipient: b.name, phone: b.phone };
    const invoice =
      shipping && b.same
        ? address
        : read(place, prefixed(form, "f_"), "Fatura adresi: ");
    const firm = b.corporate ? read(company, all) : undefined;

    if (problems.length === 0) {
      return {
        data: {
          key: b.key,
          email: contact?.email,
          phone: b.phone,
          name: b.name,
          delivery: b.delivery,
          payment: b.payment,
          gift: b.gift,
          expected_total: b.expected_total,
          documents: documents.data,
          address: address && { ...receiver, ...address },
          invoice: { recipient: b.name, phone: b.phone, ...invoice, ...firm },
        },
      };
    }
  }
  return { error: [...new Set(problems)].join(" ") };
}

// --- Panel ayarları ---------------------------------------------------------

const amount = (label: string) =>
  z.string(INVALID).transform((v, ctx) => {
    const kurus = parsePrice(v);
    if (kurus !== null) return kurus;
    ctx.addIssue(`${label}: tutarı şöyle yazın: 249,90`);
    return z.NEVER;
  });

export const transferSchema = z.object({
  id: z.uuid(INVALID),
  key: z.uuid(INVALID),
  amount: amount("Gelen tutar"),
  reference: z
    .string(INVALID)
    .trim()
    .min(1, "Banka işlem numarasını yazın.")
    .max(100, "Banka işlem numarası çok uzun."),
});

const count = (label: string) =>
  z
    .string(INVALID)
    .trim()
    .regex(/^\d{1,3}$/, `${label}: tam sayı yazın.`)
    .transform(Number);

/** "20" → 2000, "1,5" → 150, boş → null */
const vat = (label: string) =>
  z
    .string(INVALID)
    .trim()
    .regex(/^$|^\d{1,2}(,\d{1,2})?$|^100$/, `${label}: yüzdeyi yazın.`)
    .transform((v) =>
      v === "" ? null : Math.round(Number(v.replace(",", ".")) * 100),
    );

const HOLIDAYS = "Tatil günlerini şöyle yazın: 01.01.2027";

const holidays = z.string(INVALID).transform((v, ctx) => {
  const days = v
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((day) => {
      const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(day);
      if (!m) return null;
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      const date = new Date(`${iso}T00:00:00Z`);
      // 31.02 gibi olmayan gün geçersizdir veya başka güne kayar.
      const real =
        !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso);
      return real ? iso : null;
    });
  if (days.includes(null)) {
    ctx.addIssue(HOLIDAYS);
    return z.NEVER;
  }
  return [...new Set(days as string[])].sort();
});

const line = (label: string) =>
  z.string(INVALID).trim().max(200, `${label} çok uzun.`);

export const settingsSchema = z.object({
  test_mode: on,
  shipping_fee: amount("Kargo ücreti"),
  free_shipping_from: amount("Ücretsiz kargo sınırı"),
  gift_fee: amount("Hediye paketi"),
  shipping_vat_bps: vat("Kargo KDV oranı"),
  gift_vat_bps: vat("Hediye paketi KDV oranı"),
  cod_vat_bps: vat("Kapıda ödeme KDV oranı"),
  bank_holder: line("Hesap sahibi"),
  bank_iban: z
    .string(INVALID)
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .pipe(
      z
        .string()
        .regex(/^(TR\d{24})?$/, "IBAN, TR ile başlayan 26 karakter olmalı."),
    ),
  transfer_days: count("EFT bekleme süresi"),
  transfer_two_person: on,
  holidays,
  card_enabled: on,
  card_minutes: count("Kart ödeme süresi"),
  cod_enabled: on,
  cod_limit: amount("Kapıda ödeme sınırı"),
  cod_fee: amount("Kapıda ödeme ücreti"),
  cod_card: on,
  phone_check: on,
  pickup_enabled: on,
  pickup_pay: on,
  pickup_days: count("Mağazada bekleme süresi"),
  pickup_address: line("Mağaza adresi"),
  max_unpaid: count("Ödenmemiş sipariş sınırı"),
  link_days: count("Bağlantı süresi"),
});

export type Settings = z.output<typeof settingsSchema>;

/** 2000 → "20", 150 → "1,50" */
export const vatInput = (bps: number | null) =>
  bps === null ? "" : priceInput(bps).replace(/,00$/, "");

/** ["2027-01-01"] → "01.01.2027" */
export const holidayInput = (days: string[]) =>
  days.map((d) => d.split("-").reverse().join(".")).join("\n");
