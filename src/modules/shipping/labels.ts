export const shipmentStatuses = {
  created: "Oluşturuldu",
  handed_over: "Kargoya verildi",
  delivered: "Teslim edildi",
  returned: "Mağazaya geri döndü",
  cancelled: "Gönderi iptal edildi",
} as const;
export type ShipmentStatus = keyof typeof shipmentStatuses;

export const codStatuses = {
  pending: "Para bekleniyor",
  short: "Eksik geldi",
  settled: "Tamamlandı",
  over: "Fazla geldi",
} as const;

/** Geçmiş satırının okunur hâli. */
export function eventText(e: {
  field: string;
  from: string | null;
  to: string | null;
}) {
  const names: Record<string, string> =
    e.field === "status" ? shipmentStatuses : {};
  const label = {
    status: "Gönderi",
    carrier: "Firma",
    tracking_no: "Takip numarası",
  }[e.field];
  const change = [e.from, e.to].flatMap((v) => (v ? [names[v] ?? v] : []));
  return `${label ?? e.field}: ${change.join(" → ")}`;
}

/** Personelin sıradaki adımı. Kuralı veritabanı uygular; burası yalnızca düğmeyi seçer. */
export function shipmentSteps(status: ShipmentStatus, ready: boolean) {
  const steps: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
    created: ready ? ["handed_over", "cancelled"] : ["cancelled"],
    handed_over: ["delivered", "returned"],
  };
  return steps[status] ?? [];
}
