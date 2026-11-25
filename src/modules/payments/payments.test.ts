import { describe, expect, it, vi } from "vitest";
import { envSchema } from "@/lib/env";
import { fakeProvider, sign, SIGNATURE_HEADER } from "./fake";

vi.mock("server-only", () => ({}));

const SECRET = "x".repeat(32);
const SITE = "http://localhost:3000";
const fake = fakeProvider(SECRET, SITE);
const start = async () => {
  const attempt = crypto.randomUUID();
  const page = await fake.start({
    attempt,
    amount: 30000,
    installments: 1,
    orderNo: "AB2222222222",
    returnUrl: `${SITE}/donus`,
    webhookUrl: `${SITE}/bildirim`,
  });
  return { attempt, ...page };
};
const event = {
  event: "olay-1",
  attempt: crypto.randomUUID(),
  ref: "S-1",
  status: "paid",
  amount: 30000,
  currency: "TRY",
  code: null,
};
const verify = (body: string, signature?: string) =>
  fake.verify(
    new Headers(
      signature === undefined ? {} : { [SIGNATURE_HEADER]: signature },
    ),
    body,
  );

describe("bildirim imzası", () => {
  const body = JSON.stringify(event);

  it("doğru imzayı kabul eder", () => {
    expect(verify(body, sign(SECRET, body))).toEqual(event);
  });

  it.each([
    ["imzasız", body, undefined],
    ["boş imza", body, ""],
    ["kısa imza", body, "ab"],
    ["başka anahtar", body, sign("y".repeat(32), body)],
    [
      "imzadan sonra değişen tutar",
      body.replace("30000", "1"),
      sign(SECRET, body),
    ],
    ["imzadan sonra eklenen boşluk", `${body} `, sign(SECRET, body)],
  ])("reddeder: %s", (_, text, signature) => {
    expect(verify(text, signature)).toBeNull();
  });

  it.each([
    "",
    "[]",
    "{",
    JSON.stringify({ ...event, status: "refunded" }),
    JSON.stringify({ ...event, amount: "30000" }),
    JSON.stringify({ ...event, amount: -1 }),
    JSON.stringify({ ...event, attempt: "x" }),
    JSON.stringify({ ...event, event: "" }),
    JSON.stringify({ ...event, cardNumber: "0000" }),
  ])("imzası doğru olsa da bozuk içeriği reddeder: %s", (text) => {
    expect(verify(text, sign(SECRET, text))).toBeNull();
  });
});

describe("sahte banka", () => {
  it("sayfayı yalnızca doğru imzayla açar", async () => {
    const a = await start();
    const b = await start();
    const imza = new URL(a.url).searchParams.get("imza");
    expect(fake.page(a.attempt, imza)).toMatchObject({ amount: 30000 });
    expect(fake.page(b.attempt, imza)).toBeNull();
    expect(fake.page(a.attempt, "")).toBeNull();
  });

  it("karar verilmeden sonuç söylemez; ilk karar geçerlidir", async () => {
    const { attempt, ref } = await start();
    expect(await fake.query(attempt)).toBeNull();
    fake.decide(attempt, "failed");
    fake.decide(attempt, "paid");
    expect(await fake.query(attempt)).toMatchObject({
      status: "failed",
      ref,
      amount: null,
    });
    expect(fake.decide(crypto.randomUUID(), "paid")).toBeNull();
  });
});

describe("ortam", () => {
  const base = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "k",
    SITE_URL: SITE,
    PAYMENT_PROVIDER: "fake",
    FAKE_PAYMENT_SECRET: SECRET,
  };

  it("sahte sağlayıcıya yalnızca yerelde izin verir", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
    for (const SITE_URL of [
      "https://alisbebe.com",
      "https://localhost.alisbebe.com",
      "http://192.168.1.5:3000",
    ]) {
      expect(envSchema.safeParse({ ...base, SITE_URL }).success).toBe(false);
    }
  });

  it("kısa anahtarı ve bilinmeyen sağlayıcıyı reddeder", () => {
    for (const over of [
      { FAKE_PAYMENT_SECRET: "kisa" },
      { PAYMENT_PROVIDER: "iyzico" },
    ]) {
      expect(envSchema.safeParse({ ...base, ...over }).success).toBe(false);
    }
  });
});
