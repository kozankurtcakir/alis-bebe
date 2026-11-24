import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/modules/auth/actions";
import { ActionForm } from "@/modules/auth/form";

export const metadata: Metadata = { title: "Giriş" };

export default function SignInPage() {
  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">Giriş yap</h1>
      <ActionForm
        action={signIn}
        submit="Giriş yap"
        fields={[
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
            autoComplete: "current-password",
          },
        ]}
      />
      <p className="flex flex-wrap justify-between gap-3">
        <Link href="/sifremi-unuttum" className="underline">
          Şifremi unuttum
        </Link>
        <Link href="/kayit" className="underline">
          Üye ol
        </Link>
      </p>
    </>
  );
}
