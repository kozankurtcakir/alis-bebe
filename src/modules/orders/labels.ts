export const orderStatuses = {
  pending_payment: "Ödeme bekleniyor",
  awaiting_approval: "Onay bekliyor",
  approved: "Onaylandı",
  preparing: "Hazırlanıyor",
  ready_for_pickup: "Mağazada hazır",
  shipped: "Kargoda",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
  returned_to_sender: "Mağazaya geri döndü",
} as const;
export type OrderStatus = keyof typeof orderStatuses;

export const paymentStatuses = {
  pending: "Ödenmedi",
  review: "Tutar inceleniyor",
  paid: "Ödendi",
  failed: "Kart reddedildi",
  cancelled: "Ödeme iptal",
  cod_due: "Kapıda ödenecek",
  cod_collected: "Kapıda ödendi",
  refund_pending: "İade bekliyor",
  partially_refunded: "Kısmen iade edildi",
  refunded: "İade edildi",
} as const;

export const paymentMethods = {
  card: "Kredi/banka kartı",
  transfer: "Havale/EFT",
  cod: "Kapıda ödeme",
  store: "Mağazada ödeme",
} as const;

export const deliveryMethods = {
  shipping: "Kargo",
  pickup: "Mağazadan teslim",
} as const;

export const cancelCodes = {
  customer: "Müşteri iptal etti",
  staff: "Mağaza iptal etti",
  expired: "Ödeme süresi doldu",
} as const;

export const flagLabels: Record<string, string> = {
  phone: "Telefon doğrulanmadı",
  cod_limit: "Kapıda ödeme sınırının üstünde",
  amount: "Gelen tutar farklı",
  stock: "Ayrılmış stok yok",
  double: "İade edilecek para var",
};

export const attemptStatuses = {
  started: "Sonuç bekleniyor",
  failed: "Reddedildi",
  paid: "Ödendi",
  review: "Tutar farklı",
  refund_due: "İade edilecek",
} as const;

/** Geçmiş satırının okunur hâli. */
export function historyText(h: {
  field: string;
  from: string | null;
  to: string | null;
}) {
  if (h.field === "phone") return "Telefon doğrulandı";
  if (h.field === "note") return "Not";
  const isPayment = h.field === "payment_status";
  const names: Record<string, string> = isPayment
    ? paymentStatuses
    : orderStatuses;
  const change = [h.from, h.to].flatMap((v) => (v ? [names[v] ?? v] : []));
  return `${isPayment ? "Ödeme" : "Sipariş"}: ${change.join(" → ")}`;
}

/** Personelin sıradaki adımı. Kuralı veritabanı uygular; burası yalnızca düğmeyi seçer. */
export function nextSteps(status: OrderStatus, delivery: string) {
  const steps: Partial<Record<OrderStatus, OrderStatus[]>> = {
    approved: ["preparing"],
    preparing: [delivery === "pickup" ? "ready_for_pickup" : "shipped"],
    ready_for_pickup: ["delivered"],
    shipped: ["delivered", "returned_to_sender"],
  };
  return steps[status] ?? [];
}

export const canCancel = (status: OrderStatus) =>
  [
    "pending_payment",
    "awaiting_approval",
    "approved",
    "preparing",
    "ready_for_pickup",
  ].includes(status);

const dateTime = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});
export const formatDate = (iso: string) => dateTime.format(new Date(iso));
