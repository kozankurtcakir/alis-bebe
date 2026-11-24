import "server-only";
import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SITE_URL: z.url(),
});

let cached: z.infer<typeof schema> | undefined;

/** Ortam değişkenleri. İlk kullanımda doğrulanır; böylece derleme anahtarsız da çalışır. */
export function env() {
  return (cached ??= schema.parse(process.env));
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
