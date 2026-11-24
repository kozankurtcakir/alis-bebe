import type { Metadata } from "next";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { requirePermission } from "@/modules/auth/access";
import {
  addStaff,
  assignRole,
  resetMfa,
  revokeRole,
  setActive,
} from "@/modules/staff/actions";
import { EmailField, RoleField, StaffForm } from "@/modules/staff/forms";
import {
  adminRoles,
  roleLabel,
  roleLabels,
  staffRoles,
} from "@/modules/staff/labels";

export const metadata: Metadata = { title: "Personel" };

const staffSchema = z.array(
  z.object({
    id: z.string(),
    email: z.string(),
    full_name: z.string(),
    is_active: z.boolean(),
    roles: z.array(z.string()),
    mfa_enabled: z.boolean(),
  }),
);

export default async function StaffPage() {
  const access = await requirePermission("staff.manage");
  const managesAdmins = access.permissions.includes("roles.manage");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_staff");
  if (error) throw new Error(`Personel okunamadı: ${error.code}`);
  const staff = staffSchema.parse(data);

  const options = staffRoles
    .filter((r) => managesAdmins || !adminRoles.includes(r))
    .map((value) => ({ value, label: roleLabels[value] }));

  return (
    <div className="space-y-8">
      <h1 className="font-baslik text-3xl font-bold">Personel</h1>

      <section aria-labelledby="ekle" className="space-y-3">
        <h2 id="ekle" className="font-baslik text-xl font-bold">
          Personel ekle
        </h2>
        <p className="text-gri">
          Kişi önce siteye üye olmalı ve e-postasını doğrulamalı.
        </p>
        <StaffForm action={addStaff} submit="Ekle">
          <EmailField label="Üyenin e-postası" />
          <RoleField label="Rol" options={options} />
        </StaffForm>
      </section>

      <ul className="divide-y divide-gri/40 border-y border-gri/40">
        {staff.map((person) => {
          const isSelf = person.id === access.userId;
          const isAdmin = person.roles.some((r) => adminRoles.includes(r));
          const canEdit = !isSelf && (managesAdmins || !isAdmin);
          const missing = options.filter(
            (o) => !person.roles.includes(o.value),
          );

          return (
            <li key={person.id} className="space-y-4 py-5">
              <div>
                <p className="font-semibold break-words">
                  {person.full_name || "Adsız"}
                  {isSelf && " (siz)"}
                </p>
                <p className="break-words text-gri">{person.email}</p>
                <p>{person.roles.map(roleLabel).join(", ")}</p>
                <p className="text-sm">
                  {person.is_active ? "Hesap açık" : "Hesap kapalı"} · İki
                  adımlı doğrulama{" "}
                  {person.mfa_enabled ? "kurulu" : "kurulu değil"}
                </p>
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-end gap-3">
                  {person.roles.map((r) => (
                    <StaffForm
                      key={r}
                      action={revokeRole}
                      hidden={{ user: person.id, role: r }}
                      submit={`${roleLabel(r)} rolünü kaldır`}
                      subject={person.email}
                      confirm={`${person.email}: ${roleLabel(r)} rolü kaldırılsın mı?`}
                    />
                  ))}
                  <StaffForm
                    action={setActive}
                    hidden={{
                      user: person.id,
                      active: String(!person.is_active),
                    }}
                    submit={person.is_active ? "Hesabı kapat" : "Hesabı aç"}
                    subject={person.email}
                    confirm={`${person.email}: hesap ${person.is_active ? "kapatılsın" : "açılsın"} mı?`}
                  />
                  {managesAdmins && person.mfa_enabled && (
                    <StaffForm
                      action={resetMfa}
                      hidden={{ user: person.id }}
                      submit="Doğrulamayı sıfırla"
                      subject={person.email}
                      confirm={`${person.email}: iki adımlı doğrulama sıfırlansın mı? Kişinin kimliğinden emin olun.`}
                    />
                  )}
                </div>
              )}
              {canEdit && person.is_active && missing.length > 0 && (
                <StaffForm
                  action={assignRole}
                  hidden={{ user: person.id }}
                  submit="Rol ver"
                  subject={person.email}
                >
                  <RoleField label="Yeni rol" options={missing} />
                </StaffForm>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
