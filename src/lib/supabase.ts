import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cookieOptions, env } from "./env";

/** Ziyaretçi yetkisiyle çalışır; oturum ve çerez okumaz. */
export async function createPublicClient() {
  await connection(); // Fiyat ve stok her istekte güncel okunur; derleme veritabanı istemez.
  return createSupabaseClient(
    env().SUPABASE_URL,
    env().SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/** Gizli anahtarla çalışır; yalnızca e-posta kuyruğu içindir. Anahtar yoksa null. */
export function createServiceClient() {
  const key = env().SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createSupabaseClient(env().SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

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

/** Oturum çerezi var mı? Geçerli olup olmadığına veritabanı karar verir. */
export const hasSessionCookie = async () =>
  (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));
