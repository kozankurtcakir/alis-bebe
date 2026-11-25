import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentEvent, PaymentProvider, PaymentStart } from "./provider";

/*
 * Yalnızca bu bilgisayardaki denemeler için. Gerçek para hareketi ve kart bilgisi yoktur.
 * Bekleyen denemeler bellekte durur; sunucu yeniden başlayınca silinir.
 */

export const SIGNATURE_HEADER = "x-sahte-imza";

type Pending = PaymentStart & { event?: PaymentEvent };
const store = globalThis as typeof globalThis & {
  sahteOdemeler?: Map<string, Pending>;
};
const pending = (store.sahteOdemeler ??= new Map<string, Pending>());

export const sign = (secret: string, text: string) =>
  createHmac("sha256", secret).update(text).digest("hex");

function matches(secret: string, text: string, signature: string | null) {
  const expected = Buffer.from(sign(secret, text));
  const given = Buffer.from(signature ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const eventSchema = z.strictObject({
  event: z.string().min(1).max(200),
  attempt: z.uuid(),
  ref: z.string().min(1).max(200),
  status: z.enum(["paid", "failed"]),
  amount: z.number().int().min(0).nullable(),
  currency: z.string().max(10).nullable(),
  code: z.string().max(50).nullable(),
});

const refOf = (attempt: string) => `S-${attempt}`;
const pageText = (attempt: string) => `sayfa.${attempt}`;

export function fakeProvider(secret: string, siteUrl: string) {
  return {
    name: "fake",

    async start(input: PaymentStart) {
      pending.set(input.attempt, input);
      const url = new URL(`/sahte-odeme/${input.attempt}`, siteUrl);
      url.searchParams.set("imza", sign(secret, pageText(input.attempt)));
      return { ref: refOf(input.attempt), url: url.href };
    },

    async query(attempt: string) {
      return pending.get(attempt)?.event ?? null;
    },

    verify(headers: Headers, body: string) {
      if (!matches(secret, body, headers.get(SIGNATURE_HEADER))) return null;
      try {
        return eventSchema.safeParse(JSON.parse(body)).data ?? null;
      } catch {
        return null;
      }
    },

    /** Sahte banka sayfası; adresteki imza yanlışsa veya deneme yoksa null. */
    page(attempt: string, signature: string | null) {
      return matches(secret, pageText(attempt), signature)
        ? (pending.get(attempt) ?? null)
        : null;
    },

    /** Sahte bankanın kararı. İlk karar geçerlidir. */
    decide(attempt: string, status: "paid" | "failed", amount?: number) {
      const item = pending.get(attempt);
      if (!item) return null;
      return (item.event ??= {
        event: `olay-${attempt}`,
        attempt,
        ref: refOf(attempt),
        status,
        amount: status === "paid" ? (amount ?? item.amount) : null,
        currency: status === "paid" ? "TRY" : null,
        code: status === "failed" ? "reddedildi" : null,
      });
    },

    /** Bildirimi gerçek sağlayıcı gibi imzalayıp gönderir. */
    async notify(event: PaymentEvent, webhookUrl: string) {
      const body = JSON.stringify(event);
      await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: sign(secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    },
  } satisfies PaymentProvider & Record<string, unknown>;
}
