"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { cookieOptions } from "@/lib/env";
import { getAccess, requirePermission } from "@/modules/auth/access";
import { guestToken } from "@/modules/cart/guest";
import { startPayment } from "@/modules/payments/service";
import { call } from "./call";
import { ORDER_COOKIE, ORDER_NO, orderToken } from "./queries";
import { orderStatuses } from "./labels";
import { parseCheckout, settingsSchema, transferSchema } from "./validation";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;

const INVALID: PanelState = { error: "Geçersiz istek." };

const failed = (error: z.ZodError): PanelState => ({
  error: [...new Set(error.issues.map((i) => i.message))].join(" "),
});

// --- Müşteri ----------------------------------------------------------------

export const placeOrder: Action = async (_, form) => {
  const access = await getAccess();
  const input = parseCheckout(form, !access);
  if (!input.data) return { error: input.error };

  const { data, error } = await call("place_order", {
    p_token: access ? null : await guestToken(),
    p: input.data,
  });
  if (error !== null) return { error };

  const { order_no, token } = z
    .object({ order_no: z.string(), token: z.string().nullable() })
    .parse(data);
  if (token) {
    (await cookies()).set(ORDER_COOKIE, token, {
      ...cookieOptions(),
      path: `/siparis/${order_no}`,
    });
  }
  if (input.data.payment === "card") {
    const payment = await startPayment(order_no, token);
    // Sayfa açılamazsa sipariş durur; müşteri sipariş sayfasından öder.
    if ("url" in payment) redirect(payment.url);
  }
  redirect(`/siparis/${order_no}?yeni=1`);
};

export const cancelMyOrder: Action = async (_, form) => {
  const no = z.string().regex(ORDER_NO).safeParse(form.get("no"));
  if (!no.success) return INVALID;
  const { error } = await call("cancel_my_order", {
    p_no: no.data,
    p_token: await orderToken(),
  });
  return error ? { error } : { ok: "Sipariş iptal edildi." };
};

// --- Panel ------------------------------------------------------------------

const byId = z.object({ id: z.uuid() });

/** Siparişin kimliği ve ek alanlarıyla çalışan personel işlemleri. */
function orderAction<T extends z.ZodRawShape>(
  permission: string,
  shape: T,
  fn: string,
  args: (input: z.output<z.ZodObject<T>>) => Record<string, unknown>,
  ok: string,
): Action {
  const schema = z.object(shape);
  return async (_, form) => {
    await requirePermission(permission);
    const all = Object.fromEntries(form);
    const id = byId.safeParse(all);
    if (!id.success) return INVALID;
    const input = schema.safeParse(all);
    if (!input.success) return failed(input.error);
    const { error } = await call(fn, {
      p_order: id.data.id,
      ...args(input.data),
    });
    return error ? { error } : { ok };
  };
}

const note = (message: string) =>
  z.string("Geçersiz istek.").trim().min(1, message).max(500, "Not çok uzun.");

const doApprove = orderAction(
  "orders.approve",
  {},
  "approve_order",
  () => ({ p_bulk: false }),
  "Sipariş onaylandı.",
);
const doCancel = orderAction(
  "orders.cancel",
  { note: note("İptal nedenini yazın.") },
  "cancel_order",
  (i) => ({ p_reason: i.note }),
  "Sipariş iptal edildi.",
);
const doNote = orderAction(
  "orders.note",
  { note: note("Notu yazın.") },
  "add_order_note",
  (i) => ({ p_note: i.note }),
  "Not eklendi.",
);
const doVerify = orderAction(
  "orders.note",
  {},
  "verify_order_phone",
  () => ({}),
  "Telefon doğrulandı.",
);
const doCollect = orderAction(
  "orders.approve",
  { as: z.enum(["cash", "card"], "Tahsilat türünü seçin.") },
  "collect_store_payment",
  (i) => ({ p_as: i.as }),
  "Tahsilat kaydedildi.",
);

export async function approveOrder(state: PanelState, form: FormData) {
  return doApprove(state, form);
}
export async function cancelOrder(state: PanelState, form: FormData) {
  return doCancel(state, form);
}
export async function addNote(state: PanelState, form: FormData) {
  return doNote(state, form);
}
export async function verifyPhone(state: PanelState, form: FormData) {
  return doVerify(state, form);
}
export async function collectPayment(state: PanelState, form: FormData) {
  return doCollect(state, form);
}

const stepSchema = z.enum(["preparing", "ready_for_pickup", "delivered"]);

export const advanceOrder: Action = async (_, form) => {
  const id = byId.safeParse(Object.fromEntries(form));
  const to = stepSchema.safeParse(form.get("to"));
  if (!id.success || !to.success) return INVALID;
  await requirePermission(
    to.data === "preparing" ? "orders.approve" : "shipping.write",
  );
  const { error } = await call("advance_order", {
    p_order: id.data.id,
    p_to: to.data,
  });
  return error ? { error } : { ok: `Durum: ${orderStatuses[to.data]}` };
};

/** Her sipariş ayrı onaylanır; biri reddedilirse öbürleri etkilenmez. */
export const approveMany: Action = async (_, form) => {
  await requirePermission("orders.approve");
  const ids = z.array(z.uuid()).max(25).safeParse(form.getAll("ids"));
  if (!ids.success) return INVALID;
  if (ids.data.length === 0) return { error: "Önce sipariş seçin." };

  let approved = 0;
  const problems = new Set<string>();
  for (const id of new Set(ids.data)) {
    const { error } = await call("approve_order", {
      p_order: id,
      p_bulk: true,
    });
    if (error === null) approved++;
    else problems.add(error);
  }
  if (problems.size === 0) return { ok: `${approved} sipariş onaylandı.` };
  return {
    error: `${approved} sipariş onaylandı. Onaylanamayanlar: ${[...problems].join(" ")}`,
  };
};

export const matchTransfer: Action = async (_, form) => {
  await requirePermission("transfers.match");
  const input = transferSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { error } = await call("match_transfer", {
    p_order: input.data.id,
    p_amount: input.data.amount,
    p_reference: input.data.reference,
    p_key: input.data.key,
  });
  return error ? { error } : { ok: "Havale siparişe yazıldı." };
};

const results: Record<string, PanelState> = {
  paid: { ok: "Ödeme onaylandı." },
  review: { error: "Gelen toplam, sipariş tutarından farklı; incelemede." },
  refund_pending: {
    error: "Sipariş yeniden açılamadı; gelen para iade bekliyor.",
  },
};

export const confirmTransfer: Action = async (_, form) => {
  await requirePermission("transfers.confirm");
  const input = byId.safeParse(Object.fromEntries(form));
  if (!input.success) return INVALID;
  const { data, error } = await call("confirm_transfer", {
    p_transfer: input.data.id,
    p_accept_over: form.get("over") === "on",
  });
  if (error !== null) return { error };
  return results[z.string().parse(data)] ?? { ok: "Havale onaylandı." };
};

export const saveSettings: Action = async (_, form) => {
  await requirePermission("settings.critical");
  const input = settingsSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { error } = await call("set_settings", { p: input.data });
  return error ? { error } : { ok: "Ayarlar kaydedildi." };
};
