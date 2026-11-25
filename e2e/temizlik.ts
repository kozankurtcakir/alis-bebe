import { rmSync } from "node:fs";
import { sql } from "./yardim";

/**
 * Test görselleri her turda farklıdır. Birikirse Next ilk görsel isteğinde hepsini
 * tarar ve sayfalar beklemede kalır; önbellek gerektiğinde yeniden oluşur.
 *
 * Testler bitince deneme hesaplarının personel rolleri kalkar. Yoksa her turda
 * Personel sayfası uzar ve testler zaman aşımına düşer. Hesaplar, işlem geçmişi
 * onlara bağlı olduğu için silinmez; sepet ve adresleri silinir. Misafir sepetinin
 * kime ait olduğu bilinmez, bu yüzden dokunulmaz; süresi dolunca kendiliğinden silinir.
 */
export default function temizlik() {
  rmSync(".next/cache/images", { recursive: true, force: true });
  sql(`delete from public.user_roles ur using public.roles r, auth.users u
       where r.id = ur.role_id and u.id = ur.user_id
         and r.key not in ('customer', 'super_admin')
         and u.email ~ '^test-[0-9a-f-]{36}@ornek[.]test$';
       create temp table deneme as select id from auth.users
         where email ~ '^test-[0-9a-f-]{36}@ornek[.]test$';
       delete from public.carts where user_id in (select id from deneme);
       delete from public.addresses where user_id in (select id from deneme)`);
}
