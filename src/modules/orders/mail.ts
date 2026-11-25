import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase";
import { composeMail, jobSchema } from "./mail-text";

/**
 * Bekleyen iletileri gönderir; yanıttan sonra `after` ile çağrılır.
 * Yayına kadar yalnızca yerel test posta kutusuna gider. Hata siparişi etkilemez:
 * ileti kuyrukta kalır, sonraki çağrıda yeniden denenir.
 */
export async function sendPendingEmails() {
  const supabase = createServiceClient();
  const { MAIL_URL, SITE_URL } = env();
  if (!supabase || !MAIL_URL) return;
  try {
    const { data, error } = await supabase.rpc("claim_emails");
    if (error) throw new Error(error.code);
    for (const job of z.array(jobSchema).parse(data)) {
      const mail = composeMail(job, SITE_URL);
      const sent = mail ? await deliver(MAIL_URL, job, mail) : true;
      await supabase.rpc("finish_email", { p_id: job.id, p_sent: sent });
    }
  } catch (error) {
    console.error("E-posta kuyruğu işlenemedi:", (error as Error).message);
  }
}

async function deliver(
  url: string,
  to: { email: string; name: string },
  mail: { subject: string; text: string },
) {
  try {
    const response = await fetch(new URL("/api/v1/send", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "siparis@alisbebe.test", Name: "Aliş Bebe" },
        To: [{ Email: to.email, Name: to.name }],
        Subject: mail.subject,
        Text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
