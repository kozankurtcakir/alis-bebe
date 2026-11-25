// Yerel Supabase adresini ve anahtarlarını .env.local dosyasına yazar. Var olan satırlara dokunmaz.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const FILE = ".env.local";
const status = execSync("npx --no-install supabase status -o env", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const read = (key) => {
  const value = status.match(new RegExp(`^${key}="?([^"\r\n]+)"?`, "m"))?.[1];
  if (!value) throw new Error(`${key} bulunamadı. Önce: npm run db:start`);
  return value;
};

const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const missing = Object.entries({
  SUPABASE_URL: () => read("API_URL"),
  SUPABASE_PUBLISHABLE_KEY: () => read("PUBLISHABLE_KEY"),
  SUPABASE_SECRET_KEY: () => read("SECRET_KEY"),
  MAIL_URL: () => "http://127.0.0.1:54324",
  SITE_URL: () => "http://localhost:3000",
  PAYMENT_PROVIDER: () => "fake",
  FAKE_PAYMENT_SECRET: () => randomBytes(32).toString("hex"),
}).filter(([key]) => !new RegExp(`^${key}=`, "m").test(current));

if (missing.length === 0) console.log(`${FILE} tamam; değiştirilmedi.`);
else {
  const gap = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(
    FILE,
    gap + missing.map(([key, value]) => `${key}=${value()}\n`).join(""),
  );
  console.log(
    `${FILE} dosyasına eklendi: ${missing.map(([k]) => k).join(", ")}`,
  );
}
