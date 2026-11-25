import type { Metadata } from "next";
import Link from "next/link";
import { Field } from "@/components/fields";
import { PanelForm } from "@/components/panel-form";
import { saveProfile } from "@/modules/account/actions";
import { getProfile } from "@/modules/account/queries";
import { formatPhone } from "@/modules/account/validation";
import { requireUser } from "@/modules/auth/access";
import { signOut } from "@/modules/auth/actions";

export const instant = false;
export const metadata: Metadata = { title: "Hesabım" };

export default async function AccountPage() {
  const access = await requireUser();
  const profile = await getProfile();

  return (
    <div className="max-w-md space-y-6">
      <h1 className="font-baslik text-3xl font-bold">Hesabım</h1>
      <p className="break-words">{access.email}</p>
      {access.isStaff && (
        <Link
          href="/yonetim"
          className="inline-flex min-h-11 items-center underline"
        >
          Yönetim paneli
        </Link>
      )}
      <PanelForm action={saveProfile} submit="Kaydet">
        <Field
          label="Ad soyad"
          name="full_name"
          defaultValue={profile.full_name}
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
        />
        <Field
          label="Cep telefonu (isteğe bağlı)"
          name="phone"
          type="tel"
          defaultValue={profile.phone ? formatPhone(profile.phone) : ""}
          autoComplete="tel"
          maxLength={30}
          hint="Örnek: 0555 000 00 00"
        />
      </PanelForm>
      <Link
        href="/sifre-yenile"
        className="inline-flex min-h-11 items-center underline"
      >
        Şifremi değiştir
      </Link>
      <form action={signOut}>
        <button className="min-h-12 underline">Çıkış yap</button>
      </form>
    </div>
  );
}
