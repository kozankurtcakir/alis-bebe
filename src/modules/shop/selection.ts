/** İlk görülen sırayı koruyarak tekrarları atar. */
export function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(key(i)) && seen.add(key(i)));
}

/** Seçilen bedenin varyantı. Bedensiz tek varyant seçim beklemez. */
export function pickVariant<T extends { size: { code: string } | null }>(
  variants: T[],
  size: string | null,
) {
  if (variants.length === 1 && variants[0].size === null) return variants[0];
  return variants.find((v) => v.size !== null && v.size.code === size);
}
