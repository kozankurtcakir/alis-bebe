import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, env } from "@/lib/env";

/** Süresi dolan oturumu yeniler. Yetki kararı burada değil, sunucuda ve veritabanında verilir. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env().SUPABASE_URL,
    env().SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: cookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  await supabase.auth.getClaims();

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/ara",
    "/kategori/:path*",
    "/urun/:path*",
    "/sepet",
    "/giris",
    "/kayit",
    "/onay",
    "/sifremi-unuttum",
    "/sifre-yenile",
    "/iki-adim",
    "/hesap/:path*",
    "/yonetim/:path*",
  ],
};
