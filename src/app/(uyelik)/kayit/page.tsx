import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "@/modules/auth/actions";
import { ActionForm } from "@/modules/auth/form";

export const metadata: Metadata = { title: "Üye ol" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">Üye ol</h1>
      <ActionForm
        action={signUp}
        submit="Üye ol"
        fields={[
          { name: "full_name", label: "Ad soyad", autoComplete: "name" },
          {
            name: "email",
            label: "E-posta",
            type: "email",
            autoComplete: "username",
          },
          {
            name: "password",
            label: "Şifre",
            type: "password",
            autoComplete: "new-password",
            hint: "En az 10 karakter; harf ve rakam içermeli.",
          },
        ]}
      />
      <p>
        Üye misiniz?{" "}
        <Link href="/giris" className="underline">
          Giriş yapın
        </Link>
      </p>
    </>
  );
}
