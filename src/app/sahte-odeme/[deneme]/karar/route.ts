import { z } from "zod";
import { activeFake } from "@/modules/payments/service";

const decision = z.object({
  imza: z.string(),
  karar: z.enum(["onay", "red", "sessiz", "yanlis"]),
});

/** Yalnızca yerel deneme: sahte bankanın düğmeleri. Gerçek banka gibi bildirir ve geri gönderir. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/sahte-odeme/[deneme]/karar">,
) {
  const fake = activeFake();
  if (!fake) return new Response(null, { status: 404 });
  const { deneme } = await params;
  const form = await request.formData().catch(() => new FormData());
  const input = decision.safeParse(Object.fromEntries(form));
  const item = input.success && fake.page(deneme, input.data.imza);
  if (!item) return new Response(null, { status: 404 });

  const { karar } = input.data;
  const event = fake.decide(
    deneme,
    karar === "red" ? "failed" : "paid",
    karar === "yanlis" ? item.amount - 1 : undefined,
  );
  if (event && karar !== "sessiz") await fake.notify(event, item.webhookUrl);
  return new Response(null, {
    status: 303,
    headers: { location: item.returnUrl },
  });
}
