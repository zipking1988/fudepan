-- Fudepan Phase 1: core tables.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  user_id uuid not null references auth.users (id),
  display_name text not null check (char_length(display_name) between 1 and 100),
  role text not null check (role in ('elder', 'caregiver', 'coordinator')),
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (household_id, id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  created_by uuid not null references auth.users (id),
  source_type text not null check (source_type in ('image', 'text')),
  text_content text check (text_content is null or char_length(text_content) <= 5000),
  image_path text,
  ocr_text text,
  ocr_confidence numeric(4, 3) check (ocr_confidence is null or ocr_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (household_id, id),
  check (
    (source_type = 'text' and text_content is not null and image_path is null)
    or (source_type = 'image' and image_path is not null)
  ),
  -- Image objects live under "<household_id>/..." in the note-images bucket.
  check (image_path is null or image_path like household_id::text || '/%')
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  note_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  category text not null
    check (category in ('medication', 'payment', 'appointment', 'pickup', 'reminder', 'other')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_confirmation', 'confirmed', 'completed', 'cancelled', 'rejected')),
  due_at timestamptz,
  location text check (location is null or char_length(location) <= 200),
  assignee_id uuid,
  approved_by uuid,
  notes text check (notes is null or char_length(notes) <= 2000),
  needs_review boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same-household guarantees for cross-references.
  foreign key (household_id, note_id) references public.notes (household_id, id),
  foreign key (household_id, assignee_id) references public.members (household_id, id),
  foreign key (household_id, approved_by) references public.members (household_id, id),
  -- High-risk tasks cannot be confirmed or completed without a human approver.
  constraint high_risk_requires_approver check (
    risk_level <> 'high'
    or status not in ('confirmed', 'completed')
    or approved_by is not null
  ),
  -- Medication, payment, appointment and pickup tasks are always high risk.
  constraint risky_categories_are_high check (
    category not in ('medication', 'payment', 'appointment', 'pickup') or risk_level = 'high'
  )
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  task_id uuid references public.tasks (id),
  note_id uuid references public.notes (id),
  actor_id uuid references auth.users (id),
  event_type text not null check (event_type in (
    'note_created', 'task_extracted', 'task_updated', 'task_confirmation_requested',
    'task_approved', 'task_rejected', 'task_completed', 'task_cancelled',
    'calendar_event_created', 'notification_sent'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index members_user_id_idx on public.members (user_id);
create index notes_household_idx on public.notes (household_id, created_at desc);
create index tasks_household_status_idx on public.tasks (household_id, status);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index audit_events_task_idx on public.audit_events (task_id, created_at);
create index audit_events_household_idx on public.audit_events (household_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
