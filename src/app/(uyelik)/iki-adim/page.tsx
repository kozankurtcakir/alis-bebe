import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { requireUser } from "@/modules/auth/access";
import { verifyMfa } from "@/modules/auth/actions";
import { ActionForm, MfaSetupForm } from "@/modules/auth/form";

export const metadata: Metadata = { title: "İki adımlı doğrulama" };

export default async function SecondStepPage({
  searchParams,
}: PageProps<"/iki-adim">) {
  const access = await requireUser();
  if (!access.isStaff) notFound();
  if (access.hasSecondStep) redirect("/yonetim");

  const { sonra } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(`Doğrulama durumu okunamadı: ${error.code}`);

  const codeForm = (
    <ActionForm
      action={verifyMfa}
      submit="Doğrula"
      hidden={sonra === "sifre" ? { sonra } : {}}
      fields={[
        {
          name: "code",
          label: "6 haneli kod",
          autoComplete: "one-time-code",
          inputMode: "numeric",
        },
      ]}
    />
  );

  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">İki adımlı doğrulama</h1>
      {data.totp.length > 0 ? (
        codeForm
      ) : (
        <>
          <p>
            Yönetim paneli için şifrenize ek olarak telefonunuzdaki doğrulama
            uygulamasının kodu gerekir.
          </p>
          <MfaSetupForm>{codeForm}</MfaSetupForm>
        </>
      )}
    </>
  );
}
