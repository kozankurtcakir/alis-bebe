import type { PostgrestError } from "@supabase/supabase-js";

const FAILED = "İşlem yapılamadı. Biraz sonra yeniden deneyin.";

/** Veritabanı hatasını kişiye gösterilebilir Türkçe metne çevirir. */
export function dbErrorMessage(
  error: Pick<PostgrestError, "code" | "message">,
  uniqueMessages: Record<string, string> = {},
): string {
  switch (error.code) {
    case "23505": {
      const name = /constraint "(\w+)"/.exec(error.message)?.[1] ?? "";
      return (
        uniqueMessages[name] ?? "Aynı ad, adres veya kodla başka bir kayıt var."
      );
    }
    case "23503":
      return "Kayıt kullanımda olduğu için bu işlem yapılamaz.";
    case "23514":
      return "Girilen değerlerden biri kurallara uymuyor.";
  }
  // Bu kodlardaki Türkçe açıklamaları kendi fonksiyonlarımız yazar.
  if (
    ["42501", "22023", "P0002"].includes(error.code) &&
    !/permission denied|row-level security/.test(error.message)
  ) {
    return error.message;
  }
  console.error("Veritabanı işlemi başarısız:", error.code);
  return FAILED;
}
