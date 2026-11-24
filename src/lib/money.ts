const formatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

/** Kuruşu Türk lirası metnine çevirir: 24990 → "₺249,90" */
export function formatPrice(kurus: number): string {
  if (!Number.isSafeInteger(kurus)) {
    throw new RangeError("Tutar kuruş cinsinden tam sayı olmalıdır.");
  }
  return formatter.format(kurus / 100);
}
