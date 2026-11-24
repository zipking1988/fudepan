-- Fudepan: a portrait for the person being cared for (additive).
--
--   * Private Storage bucket `member-portraits` (2 MB, JPEG / PNG / WebP). Like `notes` and
--     `evidence`: no Storage policies for anon or authenticated, so browser roles cannot list,
--     read, upload, or delete (Storage RLS denies by default). Server code checks the session,
--     the active household membership, and the role, then uses the service role.
--   * One metadata row per member. Active members of the household can read the row (so a page
--     can show "has a portrait"); only the service role writes it.
--   * Only a Care_Recipient member can have a portrait, and the row's household must be the
--     member's household. A trigger enforces both, so a bug in server code cannot break them.
--   * Object path: {household_id}/{member_id}/{epoch_ms}-portrait.{jpg|png|webp}. No public URL.
-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-portraits', 'member-portraits', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
-- ---------------------------------------------------------------------------
-- Metadata
-- ---------------------------------------------------------------------------
create table public.member_portraits (
  member_id uuid primary key references public.household_members (id) on delete cascade,
  household_id uuid not null references public.households (id),
  object_path text not null unique,
  content_type text not null,
  size_bytes integer not null,
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint member_portraits_content_type_valid check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint member_portraits_size_valid check (size_bytes > 0 and size_bytes <= 2097152),
  constraint member_portraits_object_path_format check (
    object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{13}-portrait\.(jpg|png|webp)$'
    and starts_with(object_path, household_id::text || '/' || member_id::text || '/')
  ),
  constraint member_portraits_extension_matches_type check (
    (content_type = 'image/jpeg' and object_path like '%.jpg')
    or (content_type = 'image/png' and object_path like '%.png')
    or (content_type = 'image/webp' and object_path like '%.webp')
  )
);
create index member_portraits_household_idx on public.member_portraits (household_id);
comment on table public.member_portraits is
  'Portrait of a Care_Recipient member. Readable by active household members; written only by server code that checked the Primary_Caregiver role.';
create function private.check_member_portrait()
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
  if m.role <> 'care_recipient' then
    raise exception 'portrait_not_recipient' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.check_member_portrait() from public;
create trigger member_portraits_check
  before insert or update on public.member_portraits
  for each row execute function private.check_member_portrait();
alter table public.member_portraits enable row level security;
revoke all on table public.member_portraits from anon, authenticated;
grant select on table public.member_portraits to authenticated;
grant all on table public.member_portraits to service_role;
create policy member_portraits_select_household
  on public.member_portraits
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));
