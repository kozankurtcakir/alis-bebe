import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { activeProvider } from "@/modules/payments/service";
import type { OrderStatus } from "./labels";
import {
  attemptStatuses,
  deliveryMethods,
  orderStatuses,
  paymentMethods,
  paymentStatuses,
} from "./labels";
import type { Settings } from "./validation";

const keys = <T extends Record<string, string>>(o: T) =>
  z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]);

const head = {
  order_no: z.string(),
  created_at: z.string(),
  order_status: keys(orderStatuses),
  payment_status: keys(paymentStatuses),
  total: z.number(),
};
const methods = {
  delivery_method: keys(deliveryMethods),
  payment_method: keys(paymentMethods),
};
const money = {
  subtotal: z.number(),
  shipping_fee: z.number(),
  gift_fee: z.number(),
  cod_fee: z.number(),
  gift_wrap: z.boolean(),
};
const item = z.object({
  name: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  unit_price: z.number(),
  quantity: z.number(),
});
const address = z.object({
  recipient: z.string(),
  phone: z.string(),
  city: z.string(),
  district: z.string(),
  line: z.string(),
  postal_code: z.string().nullable(),
});

// --- Müşteri ----------------------------------------------------------------

const optionsSchema = z.object({
  test_mode: z.boolean(),
  shipping_fee: z.number(),
  free_shipping_from: z.number(),
  gift_fee: z.number(),
  card: z.boolean(),
  card_minutes: z.number(),
  transfer: z.boolean(),
  transfer_days: z.number(),
  cod: z.boolean(),
  cod_fee: z.number(),
  cod_limit: z.number(),
  cod_card: z.boolean(),
  pickup: z.boolean(),
  pickup_pay: z.boolean(),
  pickup_days: z.number(),
  pickup_address: z.string(),
  documents: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      body: z.string(),
      is_draft: z.boolean(),
    }),
  ),
});
export type CheckoutOptions = z.infer<typeof optionsSchema>;

export async function getCheckoutOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkout_options");
  if (error) throw new Error(`Ödeme seçenekleri okunamadı: ${error.code}`);
  const options = optionsSchema.parse(data);
  // Sağlayıcı bu sunucuda kurulu değilse kart gösterilmez.
  return { ...options, card: options.card && activeProvider() !== null };
}

export const ORDER_NO = /^AB[2-9A-HJ-NP-Z]{10}$/;
export const ORDER_COOKIE = "siparis_kod";

/** Misafirin bu siparişe ait kodu; çerez yalnızca siparişin sayfasına gönderilir. */
export async function orderToken() {
  const value = (await cookies()).get(ORDER_COOKIE)?.value;
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

const orderSchema = z.object({
  ...head,
  ...methods,
  ...money,
  payment_due_at: z.string().nullable(),
  can_cancel: z.boolean(),
  can_pay: z.boolean(),
  bank: z.object({ holder: z.string(), iban: z.string() }).nullable(),
  pickup: z
    .object({ address: z.string(), until: z.string().nullable() })
    .nullable(),
  address: address.nullable(),
  items: z.array(item),
});

/** Kişinin göremeyeceği sipariş ile olmayan sipariş ayırt edilmez. */
export async function getOrder(no: string) {
  if (!ORDER_NO.test(no)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order", {
    p_no: no,
    p_token: await orderToken(),
  });
  if (error) throw new Error(`Sipariş okunamadı: ${error.code}`);
  return orderSchema.nullable().parse(data);
}

export async function listMyOrders(page: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_orders", { p_page: page });
  if (error) throw new Error(`Siparişler okunamadı: ${error.code}`);
  const rows = z.array(z.object({ ...head, pieces: z.number() })).parse(data);
  return { rows: rows.slice(0, 20), hasNext: rows.length > 20 };
}

// --- Panel ------------------------------------------------------------------

const rowSchema = z.object({
  id: z.string(),
  ...head,
  ...methods,
  contact_name: z.string(),
  flags: z.array(z.string()),
  overdue: z.boolean(),
});

export async function listOrders(filter: {
  status: OrderStatus | "refund" | "";
  query: string;
  page: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_orders", {
    p_status: filter.status || null,
    p_query: filter.query,
    p_page: filter.page,
  });
  if (error) throw new Error(`Siparişler okunamadı: ${error.code}`);
  const rows = z.array(rowSchema).parse(data);
  return { rows: rows.slice(0, 25), hasNext: rows.length > 25 };
}

const detailSchema = z.object({
  id: z.string(),
  ...head,
  ...methods,
  ...money,
  is_member: z.boolean(),
  contact_name: z.string(),
  email: z.string(),
  phone: z.string(),
  phone_verified: z.boolean(),
  payment_due_at: z.string().nullable(),
  cancel_code: z.enum(["customer", "staff", "expired"]).nullable(),
  pickup_until: z.string().nullable(),
  flags: z.array(z.string()),
  items: z.array(item.extend({ variant_id: z.string(), sku: z.string() })),
  addresses: z.object({
    delivery: address.optional(),
    invoice: address.extend({
      company: z.string().nullable(),
      tax_office: z.string().nullable(),
      tax_no: z.string().nullable(),
    }),
  }),
  collected_as: z.enum(["cash", "card"]).nullable(),
  transfers: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      reference: z.string(),
      matched_at: z.string(),
      matched_by: z.string(),
      confirmed_at: z.string().nullable(),
      confirmed_by: z.string().nullable(),
    }),
  ),
  attempts: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      paid_amount: z.number().nullable(),
      installments: z.number(),
      status: keys(attemptStatuses),
      ref: z.string().nullable(),
      error_code: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      seq: z.number(),
      field: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      note: z.string().nullable(),
      actor: z.string().nullable(),
      at: z.string(),
    }),
  ),
});
export type OrderDetail = z.infer<typeof detailSchema>;

export async function getOrderDetail(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_detail", { p_order: id });
  if (error) throw new Error(`Sipariş okunamadı: ${error.code}`);
  return detailSchema.nullable().parse(data);
}

export async function getOrderSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_summary").single();
  if (error) throw new Error(`Sipariş özeti okunamadı: ${error.code}`);
  return z
    .object({
      awaiting: z.number(),
      review: z.number(),
      refund: z.number(),
      overdue: z.number(),
    })
    .parse(data);
}

const flag = z.boolean();
const num = z.number();
const settingsRow = z.object({
  test_mode: flag,
  shipping_fee: num,
  free_shipping_from: num,
  gift_fee: num,
  shipping_vat_bps: num.nullable(),
  gift_vat_bps: num.nullable(),
  cod_vat_bps: num.nullable(),
  bank_holder: z.string(),
  bank_iban: z.string(),
  transfer_days: num,
  transfer_two_person: flag,
  holidays: z.array(z.string()),
  card_enabled: flag,
  card_minutes: num,
  cod_enabled: flag,
  cod_limit: num,
  cod_fee: num,
  cod_card: flag,
  phone_check: flag,
  pickup_enabled: flag,
  pickup_pay: flag,
  pickup_days: num,
  pickup_address: z.string(),
  max_unpaid: num,
  link_days: num,
}) satisfies z.ZodType<Settings>;

/** RLS ayarları yalnızca Super Admin'e gösterir. */
export async function getSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) throw new Error(`Ayarlar okunamadı: ${error.code}`);
  return settingsRow.parse(
    Object.fromEntries(data.map((s) => [s.key, s.value])),
  );
}
