import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/modules/auth/access";
import { signOut } from "@/modules/auth/actions";

export const metadata: Metadata = { title: "Hesabım" };

export default async function AccountPage() {
  const access = await requireUser();

  return (
    <>
      <h1 className="font-baslik text-3xl font-bold">Hesabım</h1>
      <p className="break-words">{access.email}</p>
      {access.isStaff && (
        <Link href="/yonetim" className="block underline">
          Yönetim paneli
        </Link>
      )}
      <form action={signOut}>
        <button className="min-h-12 underline">Çıkış yap</button>
      </form>
    </>
  );
}
