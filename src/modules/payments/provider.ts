/** Sağlayıcının bildirdiği sonuç. Kart bilgisi taşımaz. */
export type PaymentEvent = {
  /** Sağlayıcının olay numarası; aynı olay bir kez işlenir. */
  event: string;
  attempt: string;
  ref: string;
  status: "paid" | "failed";
  amount: number | null;
  currency: string | null;
  code: string | null;
};

export type PaymentStart = {
  attempt: string;
  amount: number;
  installments: number;
  orderNo: string;
  returnUrl: string;
  webhookUrl: string;
};

/** Bütün ödeme sağlayıcıları bu arayüzle konuşur. Kart bilgisi yalnızca sağlayıcının sayfasına girilir. */
export interface PaymentProvider {
  name: string;
  /** Müşterinin gideceği güvenli sayfayı hazırlar. */
  start(input: PaymentStart): Promise<{ ref: string; url: string }>;
  /** Sonuç henüz yoksa null. */
  query(attempt: string, ref: string): Promise<PaymentEvent | null>;
  /** İmza veya içerik geçersizse null. */
  verify(headers: Headers, body: string): PaymentEvent | null;
}
