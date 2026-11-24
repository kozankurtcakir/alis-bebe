// Yerel Supabase adresini ve herkese açık anahtarını .env.local dosyasına yazar.
import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  console.log(".env.local zaten var; değiştirilmedi.");
  process.exit(0);
}

const status = execSync("npx --no-install supabase status -o env", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const read = (key) => {
  const value = status.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, "m"))?.[1];
  if (!value) throw new Error(`${key} bulunamadı. Önce: npm run db:start`);
  return value;
};

writeFileSync(
  ".env.local",
  `SUPABASE_URL=${read("API_URL")}\nSUPABASE_PUBLISHABLE_KEY=${read("PUBLISHABLE_KEY")}\nSITE_URL=http://localhost:3000\n`,
);
console.log(".env.local yazıldı.");
