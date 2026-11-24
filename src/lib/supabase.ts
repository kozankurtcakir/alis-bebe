import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cookieOptions, env } from "./env";

/** Giriş yapan kişinin yetkisiyle çalışan istemci; RLS her sorguda geçerlidir. */
export async function createClient() {
  await connection(); // Oturum önceden hazırlanmaz, yalnızca gerçek istekte okunur.
  const store = await cookies();

  return createServerClient(
    env().SUPABASE_URL,
    env().SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: cookieOptions(),
      cookies: {
        getAll: () => store.getAll(),
        setAll(list) {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // Sayfa çizilirken çerez yazılamaz; yenilemeyi proxy.ts yapar.
          }
        },
      },
    },
  );
}
