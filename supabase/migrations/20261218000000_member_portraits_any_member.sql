-- Fudepan: any active member may have a portrait (additive; replaces one trigger function).
--
-- 20261216000000_member_portraits.sql allowed a portrait only for a Care_Recipient member. Members
-- may now add their own photo, so the role check is dropped. Kept as before:
--   * the row's household must be the member's household (portrait_wrong_household);
--   * the member must exist and, newly checked here, be active (portrait_member_inactive);
--   * the bucket stays private with no anon/authenticated Storage policies; only the service
--     role writes rows, after server code checked "own card" or "primary caregiver for a care
--     recipient"; authenticated members still read only their own households' rows.
-- No table, data, bucket or policy changes.
create or replace function private.check_member_portrait()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m public.household_members;
begin
  select * into m from public.household_members where id = new.member_id;
  if not found or m.household_id <> new.household_id then
    raise exception 'portrait_wrong_household' using errcode = 'check_violation';
  end if;
  if not m.is_active then
    raise exception 'portrait_member_inactive' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_member_portrait() from public;
comment on table public.member_portraits is
  'Portrait of an active household member. Readable by active household members; written only by server code that checked the member themself, or a Primary_Caregiver for a Care_Recipient.';
