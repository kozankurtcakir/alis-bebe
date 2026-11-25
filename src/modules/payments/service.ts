import "server-only";
import { z } from "zod";
import { dbErrorMessage } from "@/lib/db-error";
import { env } from "@/lib/env";
import { createClient, createServiceClient } from "@/lib/supabase";
import { fakeProvider } from "./fake";
import type { PaymentEvent, PaymentProvider } from "./provider";

export function activeFake() {
  const { PAYMENT_PROVIDER, FAKE_PAYMENT_SECRET, SITE_URL } = env();
  return PAYMENT_PROVIDER === "fake" && FAKE_PAYMENT_SECRET
    ? fakeProvider(FAKE_PAYMENT_SECRET, SITE_URL)
    : null;
}

/** Seçili sağlayıcı. Anahtarlar eksikse null: kart ödemesi kapalıdır. */
export const activeProvider = (): PaymentProvider | null =>
  env().SUPABASE_SECRET_KEY ? activeFake() : null;

const started = z.object({
  attempt: z.uuid(),
  provider: z.string(),
  amount: z.number(),
  installments: z.number(),
  url: z.string().nullable(),
  order_no: z.string(),
});

const UNAVAILABLE = "Kart ödemesi şu anda başlatılamıyor. Biraz sonra deneyin.";

/** Güvenli ödeme sayfasının adresi. Siparişe erişim hakkına ve tutara veritabanı karar verir. */
export async function startPayment(
  no: string,
  token: string | null,
): Promise<{ url: string } | { error: string }> {
  const provider = activeProvider();
  const service = createServiceClient();
  if (!provider || !service) return { error: UNAVAILABLE };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("begin_card_payment", {
    p_no: no,
    p_token: token,
  });
  if (error) return { error: dbErrorMessage(error) };
  const s = started.parse(data);
  if (s.provider !== provider.name) return { error: UNAVAILABLE };
  if (s.url) return { url: s.url };

  try {
    const { SITE_URL } = env();
    const page = await provider.start({
      attempt: s.attempt,
      amount: s.amount,
      installments: s.installments,
      orderNo: s.order_no,
      returnUrl: new URL(`/siparis/${s.order_no}/odeme-donus`, SITE_URL).href,
      webhookUrl: new URL(`/api/odeme/${provider.name}`, SITE_URL).href,
    });
    const saved = await service.rpc("attach_card_attempt", {
      p_attempt: s.attempt,
      p_ref: page.ref,
      p_url: page.url,
    });
    if (saved.error) throw new Error(saved.error.code);
    return { url: z.url().parse(saved.data) };
  } catch (error) {
    console.error("Kart ödemesi başlatılamadı:", (error as Error).message);
    return { error: UNAVAILABLE };
  }
}

/** Doğrulanmış bildirimi yazar. Hata kodu dönerse hiçbir şey değişmemiştir. */
export async function recordEvent(
  provider: string,
  e: PaymentEvent,
): Promise<{ result: string } | { error: string }> {
  const service = createServiceClient();
  if (!service) return { error: "anahtar" };
  const { data, error } = await service.rpc("record_card_event", {
    p_provider: provider,
    p_event: e.event,
    p_attempt: e.attempt,
    p_ref: e.ref,
    p_status: e.status,
    p_amount: e.amount,
    p_currency: e.currency,
    p_code: e.code,
  });
  if (!error) return { result: String(data) };
  console.error("Ödeme bildirimi işlenemedi:", error.code);
  return { error: error.code };
}

const checks = z.array(
  z.object({ attempt: z.string(), provider: z.string(), ref: z.string() }),
);

/** Bildirimi gelmeyen denemeleri sağlayıcıya sorar. Hata sonraki sorguya kalır. */
export async function checkPayments(no?: string): Promise<boolean> {
  const provider = activeProvider();
  const service = createServiceClient();
  if (!provider || !service) return false;
  try {
    const { data, error } = await service.rpc("claim_card_checks", {
      p_no: no ?? null,
    });
    if (error) throw new Error(error.code);
    for (const c of checks.parse(data)) {
      if (c.provider !== provider.name) continue;
      const event = await provider.query(c.attempt, c.ref);
      if (event) await recordEvent(provider.name, event);
    }
    return true;
  } catch (error) {
    console.error("Ödeme sorgulanamadı:", (error as Error).message);
    return false;
  }
}
