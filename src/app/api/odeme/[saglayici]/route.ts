import { after } from "next/server";
import { sendPendingEmails } from "@/modules/orders/mail";
import { activeProvider, recordEvent } from "@/modules/payments/service";

const MAX_BYTES = 64 * 1024;
const answer = (status: number) => new Response(null, { status });

/**
 * Ödeme sağlayıcısının bildirimi (webhook). İmzasız istek veritabanına ulaşmaz.
 * Ödeme sayılıp sayılmayacağına `record_card_event` karar verir.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/odeme/[saglayici]">,
) {
  const provider = activeProvider();
  if (!provider || provider.name !== (await params).saglayici) {
    return answer(404);
  }
  const length = request.headers.get("content-length");
  if (!length) return answer(411);
  if (!(Number(length) <= MAX_BYTES)) return answer(413);

  const event = provider.verify(request.headers, await request.text());
  if (!event) return answer(401);

  const result = await recordEvent(provider.name, event);
  if ("result" in result) {
    // Yinelenen bildirim hiçbir şeyi değiştirmez; kuyruğu da çalıştırmaz.
    if (!["duplicate", "ignored"].includes(result.result)) {
      after(sendPendingEmails);
    }
    return answer(200);
  }
  // 4xx: yeniden göndermek sonucu değiştirmez. 500: sağlayıcı yeniden denesin.
  if (result.error === "P0002") return answer(404);
  return answer(result.error === "22023" ? 409 : 500);
}
