"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import type { MessageKey } from "@/lib/i18n/messages";
import { clearInviteCookie } from "@/lib/membership/invite-cookie";
import { membershipRefusalKey } from "@/lib/membership/refusals";
import { createHouseholdInput, validateForm } from "@/lib/membership/schemas";
import { createHousehold as createHouseholdService } from "@/lib/membership/service";

export type CreateHouseholdState = {
  values: { householdName: string; displayName: string };
  fieldKeys: Record<string, MessageKey>;
  errorKey: MessageKey | null;
};

export async function createHousehold(
  _previous: CreateHouseholdState,
  formData: FormData,
): Promise<CreateHouseholdState> {
  const text = (name: string) => (typeof formData.get(name) === "string" ? String(formData.get(name)) : "");
  const raw = { householdName: text("householdName"), displayName: text("displayName") };

  const { user } = await getSession();
  if (!user) redirect("/login?next=%2Fwelcome");

  const validated = validateForm(createHouseholdInput, raw);
  if (!validated.ok) return { values: raw, fieldKeys: validated.fieldKeys, errorKey: null };

  const result = await createHouseholdService({
    userId: user.id,
    householdName: validated.data.householdName,
    displayName: validated.data.displayName,
  });
  if (!result.ok) {
    if (result.code === "already_in_household" || result.code === "one_household_only") redirect("/family");
    return { values: raw, fieldKeys: {}, errorKey: membershipRefusalKey(result.code) };
  }
  await clearInviteCookie();
  redirect("/family");
}
