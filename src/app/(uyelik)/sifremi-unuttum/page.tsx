import type { Metadata } from "next";
import { requestPasswordReset } from "@/modules/auth/actions";
import { ActionForm } from "@/modules/auth/form";

export const metadata: Metadata = { title: "Şifremi unuttum" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">Şifremi unuttum</h1>
      <ActionForm
        action={requestPasswordReset}
        submit="Bağlantı gönder"
        fields={[
          {
            name: "email",
            label: "E-posta",
            type: "email",
            autoComplete: "username",
          },
        ]}
      />
    </>
  );
}
