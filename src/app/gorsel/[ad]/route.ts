import { env } from "@/lib/env";

/**
 * Ürün görselini kendi adresimizden sunar; tarayıcı depoya doğrudan bağlanmaz ve
 * güvenlik başlığına (CSP) dış adres eklenmez.
 */
export async function GET(
  _: Request,
  { params }: RouteContext<"/gorsel/[ad]">,
) {
  const { ad } = await params;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/.test(ad)) {
    return new Response(null, { status: 404 });
  }

  const upstream = await fetch(
    `${env().SUPABASE_URL}/storage/v1/object/public/product-images/${ad}`,
    { cache: "no-store" },
  );
  if (!upstream.ok) {
    return new Response(null, { status: upstream.status < 500 ? 404 : 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/webp",
      // Dosya adı hiç yeniden kullanılmaz; silinen görsel bir gün içinde kaybolur.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
