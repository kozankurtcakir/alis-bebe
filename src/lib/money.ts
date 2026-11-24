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

/** Türkçe yazılmış tutarı kuruşa çevirir: "1.249,90" → 124990. Geçersizse null. */
export function parsePrice(text: string): number | null {
  const value = text.trim();
  // Nokta yalnızca binlik ayırıcıdır; "249.90" belirsiz olduğu için reddedilir.
  if (!/^(\d{1,9}|\d{1,3}(\.\d{3}){1,2})(,\d{1,2})?$/.test(value)) return null;
  const [lira, kurus = ""] = value.replaceAll(".", "").split(",");
  return Number(lira) * 100 + Number(kurus.padEnd(2, "0"));
}

/** Form alanı için: 24990 → "249,90" */
export const priceInput = (kurus: number) =>
  `${Math.trunc(kurus / 100)},${String(kurus % 100).padStart(2, "0")}`;
