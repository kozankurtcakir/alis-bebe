import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieOptions } from "@/lib/env";
import { ORDER_COOKIE, ORDER_NO } from "@/modules/orders/queries";

/**
 * E-postadaki gizli bağlantı. Kod yalnızca bu siparişe gönderilen, betiklere
 * kapalı bir çereze taşınır; adres çubuğunda kalmaz. Kodu veritabanı doğrular.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/siparis/[no]/ac">,
) {
  const { no } = await params;
  if (!ORDER_NO.test(no)) redirect("/");
  const token = new URL(request.url).searchParams.get("kod");
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    (await cookies()).set(ORDER_COOKIE, token, {
      ...cookieOptions(),
      path: `/siparis/${no}`,
    });
  }
  redirect(`/siparis/${no}`);
}
