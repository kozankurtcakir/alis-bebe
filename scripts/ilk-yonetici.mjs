// Yerel veritabanında ilk Super Admin'i oluşturur. E-posta hiçbir dosyaya yazılmaz.
// Kullanım: npm run ilk-yonetici -- kisi@ornek.test
import { spawnSync } from "node:child_process";

const email = process.argv[2];
if (!email) {
  console.error("Kullanım: npm run ilk-yonetici -- kisi@ornek.test");
  process.exit(1);
}

// :'email' değeri psql tarafından güvenle tırnaklanır.
const result = spawnSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_alis-bebe",
    "psql",
    "-U",
    "postgres",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `email=${email}`,
  ],
  {
    input: "select private.bootstrap_super_admin(:'email');\n",
    encoding: "utf8",
  },
);

if (result.status !== 0) {
  console.error(result.stderr || "Docker çalışmıyor. Önce: npm run db:start");
  process.exit(1);
}
console.log(
  "Super Admin oluşturuldu. /giris sayfasından girip iki adımı kurun.",
);
