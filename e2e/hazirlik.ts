import { sql } from "./yardim";

const literal = (v: string) => `'${v.replaceAll("'", "''")}'`;

/**
 * Sipariş testleri için ödeme yöntemlerini açar; testler bitince ayarlar eski hâline döner.
 * IBAN, belgelerde kullanılan örnek numaradır; gerçek hesap değildir.
 */
export default function hazirlik() {
  const before = sql(
    "select jsonb_object_agg(key, value) from public.settings",
  );
  sql(`update public.settings s set value = v.value
       from jsonb_each('{"bank_iban": "TR330006100519786457841326", "bank_holder": "Deneme Hesabı",
         "shipping_fee": 20000, "free_shipping_from": 100000, "gift_fee": 500,
         "card_enabled": true, "card_minutes": 30, "cod_enabled": true, "cod_limit": 50000, "cod_fee": 1500, "phone_check": true,
         "pickup_enabled": true, "pickup_pay": true, "pickup_days": 7, "max_unpaid": 3,
         "transfer_two_person": false, "link_days": 90, "test_mode": true}'::jsonb) v
       where s.key = v.key`);

  return () => {
    sql(`update public.settings s set value = v.value, updated_by = null
         from jsonb_each(${literal(before)}::jsonb) v where s.key = v.key and s.value <> v.value`);
  };
}
