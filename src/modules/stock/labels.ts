/** Personelin elle yapabildiği işlemler. */
export const manualReasons = [
  "initial",
  "purchase",
  "damage",
  "adjustment",
] as const;

export type ManualReason = (typeof manualReasons)[number];

export const isManual = (reason: string): reason is ManualReason =>
  (manualReasons as readonly string[]).includes(reason);

const reasonLabels: Record<string, string> = {
  initial: "İlk stok",
  purchase: "Mal girişi",
  damage: "Hasar / kayıp",
  adjustment: "Sayım",
  sale: "Satış",
  cancel: "Sipariş iptali",
  return: "İade",
  import: "Excel",
  reversal: "Ters kayıt",
};

export const reasonLabel = (reason: string) => reasonLabels[reason] ?? reason;

export const stateLabels = {
  all: "Hepsi",
  critical: "Kritik",
  out: "Tükendi",
} as const;

/** Uyarı yalnızca satılabilecek varyantlar içindir. */
export function stockState(row: {
  available: number;
  critical_level: number;
  is_sellable: boolean;
}) {
  if (!row.is_sellable) return "Satışta değil";
  if (row.available === 0) return "Tükendi";
  return row.available <= row.critical_level ? "Kritik" : null;
}
