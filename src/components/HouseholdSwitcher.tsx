import { t } from "@/lib/i18n/messages";
import type { Membership } from "@/server/session";

/** A plain HTML form, so it works without JavaScript. The server checks membership. */
export function HouseholdSwitcher({
  memberships,
  activeId,
}: {
  memberships: Membership[];
  activeId: string;
}) {
  if (memberships.length < 2) return null;
  return (
    <form
      method="post"
      action="/api/households/select"
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor="household-select" className="text-lg font-semibold">
        {t.household.switchLabel}
      </label>
      <select
        id="household-select"
        name="householdId"
        defaultValue={activeId}
        className="min-h-12 rounded-md border-2 border-edge bg-paper px-3 text-lg"
      >
        {memberships.map((m) => (
          <option key={m.householdId} value={m.householdId}>
            {m.householdName}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="inline-flex min-h-12 min-w-12 items-center rounded-md border-2 border-sage-800 px-4 text-lg font-semibold text-sage-800 hover:bg-sage-100"
      >
        {t.household.switchButton}
      </button>
    </form>
  );
}
