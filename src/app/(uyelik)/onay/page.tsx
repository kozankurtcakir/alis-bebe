import type { Metadata } from "next";
import { confirmEmailLink } from "@/modules/auth/actions";
import { ActionForm } from "@/modules/auth/form";

export const metadata: Metadata = {
  title: "Bağlantıyı onayla",
  // Adresteki tek kullanımlık kod başka sitelere taşınmasın.
  referrer: "no-referrer",
};

export default async function ConfirmPage({
  searchParams,
}: PageProps<"/onay">) {
  const { token_hash, type } = await searchParams;
  const recovery = type === "recovery";

  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">
        {recovery ? "Şifre yenileme" : "E-posta doğrulama"}
      </h1>
      <p>Devam etmek için düğmeye basın.</p>
      <ActionForm
        action={confirmEmailLink}
        submit={recovery ? "Şifremi yenile" : "E-postamı doğrula"}
        hidden={{
          token_hash: typeof token_hash === "string" ? token_hash : "",
          type: typeof type === "string" ? type : "",
        }}
      />
    </>
  );
}
