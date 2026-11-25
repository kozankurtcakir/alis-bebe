import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dbErrorMessage } from "@/lib/db-error";
import { createClient } from "@/lib/supabase";
import { checkPayments } from "@/modules/payments/service";
import { sendPendingEmails } from "./mail";

/** Sipariş işlemi. Yetkiye, tutara ve durum geçişine veritabanı karar verir. */
export async function call(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  // Hatada da sayfa yenilenir: fiyat, stok veya durum değişmiş olabilir.
  revalidatePath("/", "layout");
  if (error) return { data: null, error: dbErrorMessage(error) };
  after(async () => {
    await checkPayments();
    await sendPendingEmails();
  });
  return { data: data as unknown, error: null };
}
