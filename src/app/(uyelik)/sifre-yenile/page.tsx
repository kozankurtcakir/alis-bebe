import type { Metadata } from "next";
import { requireUser } from "@/modules/auth/access";
import { updatePassword } from "@/modules/auth/actions";
import { ActionForm } from "@/modules/auth/form";

export const metadata: Metadata = { title: "Yeni şifre" };

export default async function NewPasswordPage() {
  await requireUser();

  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">Yeni şifre</h1>
      <ActionForm
        action={updatePassword}
        submit="Şifreyi kaydet"
        fields={[
          {
            name: "password",
            label: "Yeni şifre",
            type: "password",
            autoComplete: "new-password",
            hint: "En az 10 karakter; harf ve rakam içermeli.",
          },
        ]}
      />
    </>
  );
}
