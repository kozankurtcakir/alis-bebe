"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { requirePermission } from "@/modules/auth/access";
import { sendPendingEmails } from "@/modules/orders/mail";
import { ORDER_NO, orderToken } from "@/modules/orders/queries";
import { checkPayments, startPayment } from "./service";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;
const INVALID: PanelState = { error: "Geçersiz istek." };
const orderNo = z.string().regex(ORDER_NO);

/** Müşteri: güvenli ödeme sayfasına git. */
export const payOrder: Action = async (_, form) => {
  const no = orderNo.safeParse(form.get("no"));
  if (!no.success) return INVALID;
  const result = await startPayment(no.data, await orderToken());
  if ("error" in result) return result;
  redirect(result.url);
};

/** Panel: bildirimi gelmeyen ödemeyi sağlayıcıya sor. */
export const checkOrderPayment: Action = async (_, form) => {
  await requirePermission("orders.approve");
  const no = orderNo.safeParse(form.get("no"));
  if (!no.success) return INVALID;
  const asked = await checkPayments(no.data);
  after(sendPendingEmails);
  revalidatePath("/yonetim", "layout");
  return asked
    ? { ok: "Ödeme sorgulandı. Sonuç geldiyse durum güncellendi." }
    : { error: "Ödeme sağlayıcısına ulaşılamadı." };
};
