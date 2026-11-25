import { z } from "zod";
import { formatPrice } from "@/lib/money";

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(["order_placed", "order_status"]),
  status: z.string().nullable(),
  email: z.string(),
  name: z.string(),
  order_no: z.string(),
  total: z.number(),
  payment_method: z.string(),
  delivery_method: z.string(),
  token: z.string().nullable(),
  shipment: z
    .object({
      carrier: z.string(),
      tracking_no: z.string(),
      url: z.string().nullable(),
    })
    .nullable(),
});

const statusTexts: Record<string, string> = {
  awaiting_approval: "Ödemeniz alındı. Siparişiniz onay bekliyor.",
  approved: "Siparişiniz onaylandı.",
  ready_for_pickup: "Siparişiniz mağazada hazır.",
  shipped: "Siparişiniz kargoya verildi.",
  delivered: "Siparişiniz teslim edildi.",
  cancelled: "Siparişiniz iptal edildi.",
};

const placedTexts: Record<string, string> = {
  card: "Siparişinizi aldık. Ödemeyi tamamlamadıysanız sipariş sayfanızdan devam edebilirsiniz.",
  transfer:
    "Siparişinizi aldık. Ödeme bilgileri ve son ödeme tarihi sipariş sayfanızda.",
  cod: "Siparişinizi aldık. Onay için sizi arayabiliriz; ödemeyi kapıda yaparsınız.",
  store:
    "Siparişinizi aldık. Hazır olunca haber vereceğiz; ödemeyi mağazada yaparsınız.",
};

const trackingText = (s: {
  carrier: string;
  tracking_no: string;
  url: string | null;
}) =>
  [
    `Kargo firması: ${s.carrier}`,
    `Takip numarası: ${s.tracking_no}`,
    ...(s.url ? [`Kargonuzu izleyin: ${s.url}`] : []),
  ].join("\n");

/** İleti metni. Haber verilmeyen durumda null. */
export function composeMail(job: z.infer<typeof jobSchema>, siteUrl: string) {
  const text =
    job.kind === "order_placed"
      ? placedTexts[job.payment_method]
      : statusTexts[job.status ?? ""];
  if (!text) return null;

  const link = new URL(`/siparis/${job.order_no}`, siteUrl);
  if (job.token) {
    link.pathname += "/ac";
    link.searchParams.set("kod", job.token);
  }
  return {
    subject: `Aliş Bebe siparişi ${job.order_no}`,
    text: [
      `Merhaba ${job.name},`,
      text,
      ...(job.status === "shipped" && job.shipment
        ? [trackingText(job.shipment)]
        : []),
      `Sipariş numarası: ${job.order_no}\nToplam: ${formatPrice(job.total)}`,
      `Siparişinizi görün: ${link}`,
      job.token
        ? "Bu bağlantı siparişinizi açar; başkalarıyla paylaşmayın."
        : "Görmek için hesabınıza giriş yapmanız gerekir.",
    ].join("\n\n"),
  };
}
