/** Yalnızca gösterim içindir. Gerçek tutarı veritabanı hesaplar ve karşılaştırır. */
export function previewTotal(
  subtotal: number,
  choice: { delivery: string; payment: string; gift: boolean },
  fees: {
    shipping_fee: number;
    free_shipping_from: number;
    gift_fee: number;
    cod_fee: number;
  },
) {
  const shipping =
    choice.delivery === "shipping" && subtotal < fees.free_shipping_from
      ? fees.shipping_fee
      : 0;
  const gift = choice.gift ? fees.gift_fee : 0;
  const cod = choice.payment === "cod" ? fees.cod_fee : 0;
  return { shipping, gift, cod, total: subtotal + shipping + gift + cod };
}
