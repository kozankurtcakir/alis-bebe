import { after } from "next/server";
import { sendPendingEmails } from "@/modules/orders/mail";
import { getOrder, ORDER_NO } from "@/modules/orders/queries";
import { checkPayments } from "@/modules/payments/service";

const to = (path: string) =>
  new Response(null, { status: 303, headers: { location: path } });

/**
 * Müşteri ödeme sayfasından döner. Dönüş ödeme kanıtı değildir: sonuç
 * sağlayıcıya sunucudan sorulur, adresteki hiçbir bilgi okunmaz.
 */
export async function GET(
  _: Request,
  { params }: RouteContext<"/siparis/[no]/odeme-donus">,
) {
  const { no } = await params;
  if (!ORDER_NO.test(no)) return to("/");
  if (await getOrder(no)) {
    await checkPayments(no);
    after(sendPendingEmails);
  }
  return to(`/siparis/${no}`);
}

/** Sağlayıcı form göndererek döndürebilir; çerezler ancak sonraki GET ile gelir. */
export async function POST(
  _: Request,
  { params }: RouteContext<"/siparis/[no]/odeme-donus">,
) {
  const { no } = await params;
  return to(ORDER_NO.test(no) ? `/siparis/${no}/odeme-donus` : "/");
}
