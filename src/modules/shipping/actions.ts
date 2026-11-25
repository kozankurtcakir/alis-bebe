"use server";

import { z } from "zod";
import type { PanelState } from "@/components/panel-form";
import { requirePermission } from "@/modules/auth/access";
import { call } from "@/modules/orders/call";
import { codStatuses, shipmentStatuses } from "./labels";
import { manualProvider } from "./provider";
import { carrierSchema, codSchema, trackingSchema } from "./validation";

type Action = (state: PanelState, form: FormData) => Promise<PanelState>;

const INVALID: PanelState = { error: "Geçersiz istek." };
const failed = (error: z.ZodError): PanelState => ({
  error: [...new Set(error.issues.map((i) => i.message))].join(" "),
});
const byId = z.object({ id: z.uuid() });

export const saveCarrier: Action = async (_, form) => {
  await requirePermission("settings.basic");
  const input = carrierSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { error } = await call("save_carrier", {
    p_id: input.data.id,
    p_name: input.data.name,
    p_url: input.data.url,
    p_active: input.data.active,
  });
  return error ? { error } : { ok: "Kargo firması kaydedildi." };
};

export const createShipment: Action = async (_, form) => {
  await requirePermission("shipping.write");
  const input = byId.safeParse(Object.fromEntries(form));
  if (!input.success) return INVALID;
  const { data, error } = await call("create_shipment", {
    p_order: input.data.id,
  });
  if (error !== null) return { error };
  const shipment = z.uuid().parse(data);
  const opened = await manualProvider.open(shipment);
  if (opened) {
    const { error } = await call("update_shipment", {
      p_shipment: shipment,
      p_carrier: opened.carrierId,
      p_tracking: opened.trackingNo,
    });
    if (error !== null) return { error };
  }
  return { ok: "Gönderi oluşturuldu." };
};

export const saveTracking: Action = async (_, form) => {
  await requirePermission("shipping.write");
  const input = trackingSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { error } = await call("update_shipment", {
    p_shipment: input.data.id,
    p_carrier: input.data.carrier,
    p_tracking: input.data.tracking,
  });
  return error ? { error } : { ok: "Takip bilgisi kaydedildi." };
};

const step = z.enum(["handed_over", "delivered", "returned", "cancelled"]);

export const advanceShipment: Action = async (_, form) => {
  await requirePermission("shipping.write");
  const id = byId.safeParse(Object.fromEntries(form));
  const to = step.safeParse(form.get("to"));
  if (!id.success || !to.success) return INVALID;
  const { error } = await call("advance_shipment", {
    p_shipment: id.data.id,
    p_to: to.data,
  });
  return error ? { error } : { ok: shipmentStatuses[to.data] };
};

export const recordCod: Action = async (_, form) => {
  await requirePermission("cod.reconcile");
  const input = codSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return failed(input.error);
  const { data, error } = await call("record_cod", {
    p_settlement: input.data.id,
    p_amount: input.data.amount,
    p_reference: input.data.reference,
    p_key: input.data.key,
  });
  if (error !== null) return { error };
  const status = z.enum(["pending", "short", "settled", "over"]).parse(data);
  return { ok: `Kaydedildi: ${codStatuses[status]}` };
};
