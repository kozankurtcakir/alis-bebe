import "server-only";
import { z } from "zod";

const isLocal = (url: string) =>
  ["127.0.0.1", "localhost"].includes(new URL(url).hostname);

export const envSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SITE_URL: z.url(),
    // E-posta kuyruğu için; yoksa ileti gönderilmez, kuyrukta bekler.
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    // Yayına kadar yalnızca bu bilgisayardaki test posta kutusu.
    MAIL_URL: z.url().refine(isLocal).optional(),
    // Seçili ödeme sağlayıcısı; yoksa kart ödemesi kapalıdır.
    PAYMENT_PROVIDER: z.enum(["fake"]).optional(),
    FAKE_PAYMENT_SECRET: z.string().min(32).optional(),
  })
  .refine((v) => v.PAYMENT_PROVIDER !== "fake" || isLocal(v.SITE_URL), {
    message: "Sahte ödeme sağlayıcısı yalnızca yerelde çalışır.",
  });

let cached: z.infer<typeof envSchema> | undefined;

/** Ortam değişkenleri. İlk kullanımda doğrulanır; böylece derleme anahtarsız da çalışır. */
export function env() {
  return (cached ??= envSchema.parse(process.env));
}

/** Oturum çerezi tarayıcıdaki betiklere kapalıdır. */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().SITE_URL.startsWith("https://"),
    path: "/",
  };
}
